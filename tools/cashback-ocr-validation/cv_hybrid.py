"""
Hybrid OCR engine: Cloud Vision OCR + Gemini Flash as parser.

Pipeline:
  1. Cloud Vision DOCUMENT_TEXT_DETECTION extracts text + bounding polys
     from the receipt image. Deterministic, ~1.50 USD per 1000 pages.
  2. Gemini 2.5 Flash receives the extracted TEXT (not the image) plus
     a structured-output prompt. Returns Receipt JSON.
     Stable on text input (much less variance than on images).

Cost at 1.5k bons/day = 45k/month:
  - Cloud Vision: $67/month
  - Gemini Flash text-only: ~$70/month (much fewer tokens than image input)
  - Total: ~$140/month — comparable to direct-Gemini cost,
    significantly more deterministic.

Bounding boxes returned: from Cloud Vision's text annotations, mapped to
our standard bbox schema with labels assigned heuristically based on the
parsed Receipt fields.
"""

from __future__ import annotations

import json
import logging
import mimetypes
import os
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from google.cloud import vision
from google import genai
from google.genai import types
from pydantic import ValidationError

from prompts import VERSION as PROMPT_VERSION_BASE
from schema import Receipt
from docai import _detect_dach_retailer, _looks_like_bad_merchant


logger = logging.getLogger(__name__)


CV_HYBRID_VERSION = f"cvhybrid-v1.0+{PROMPT_VERSION_BASE}"

# Pricing (USD per 1000 pages for Vision; per 1M tokens for Gemini)
CV_PRICING = {
    "vision_per_page_usd":   0.0015,    # Cloud Vision DOCUMENT_TEXT_DETECTION
    "gemini_in_per_mtok":    0.30,      # Gemini 2.5 Flash input
    "gemini_out_per_mtok":   2.50,      # Gemini 2.5 Flash output
}


# ---------------------------------------------------------------------------
# Result dataclass
# ---------------------------------------------------------------------------


@dataclass
class BoundingBox:
    label: str
    text: str
    confidence: float
    x: float
    y: float
    w: float
    h: float


@dataclass
class CVHybridResult:
    bon: str
    ok: bool
    engine: str          # "cv-hybrid/flash"
    promptVersion: str
    latencyMs: int
    cv_latency_ms: int
    gemini_latency_ms: int
    pages: int
    inputTokens: Optional[int]
    outputTokens: Optional[int]
    receipt: Optional[Receipt]
    error: Optional[str]
    rawText: Optional[str]   # OCR'd text from Cloud Vision
    boundingBoxes: list[BoundingBox]


# ---------------------------------------------------------------------------
# Cached clients
# ---------------------------------------------------------------------------

_vision_client: Optional[vision.ImageAnnotatorClient] = None
_gemini_client: Optional[genai.Client] = None


def _get_vision_client() -> vision.ImageAnnotatorClient:
    global _vision_client
    if _vision_client is None:
        _vision_client = vision.ImageAnnotatorClient()
    return _vision_client


def _get_gemini_client() -> genai.Client:
    global _gemini_client
    if _gemini_client is None:
        api_key = os.environ.get("GEMINI_API_KEY")
        if not api_key:
            raise RuntimeError("GEMINI_API_KEY env var required for hybrid engine")
        _gemini_client = genai.Client(api_key=api_key)
    return _gemini_client


# ---------------------------------------------------------------------------
# Prompt for the parser stage (text → Receipt JSON)
# ---------------------------------------------------------------------------

PARSER_SYSTEM_PROMPT = """\
Du bist ein Spezialist für die Strukturierung von OCR-extrahierten Texten
deutscher Kassenbons (DACH-Raum: DE, AT, CH).

INPUT: roher OCR-Text aus dem Cloud Vision OCR (zeilenweise, in Lesereihenfolge).
TASK: extrahiere strukturierte Felder gemäß Schema, antworte NUR mit JSON.

REGELN:

1. **Beträge IMMER in Cents als Integer** (z. B. €1,29 → 129). Niemals Float,
   niemals mit Währungszeichen.
2. **Datum als ISO YYYY-MM-DD**. Wenn nicht eindeutig → null.
3. **Uhrzeit als HH:MM** (24h).
4. **Items**:
   - Nur echte Produkt-Zeilen. KEINE Pfand-Zeilen separat (außer
     getaggt; siehe unten), KEINE Steuer-Zeilen, KEINE Rabatt-Zeilen.
   - Wenn Pfand explizit als eigene Zeile geführt wird (z. B.
     "Pfand 0,25 M" als eigene Zeile NACH einem Getränk), nimm das
     als eigenes Item auf — viele Kassen drucken das so. Tag als
     `category="Pfand"` falls erkennbar.
   - **Discount/Rabatt-Handling**: wenn nach einem Item eine
     "RABATT -X,XX €" Zeile steht, ziehe den Rabatt vom Item-Preis ab
     und nimm den Netto-Preis. Item nur EINMAL, mit korrigiertem Preis.
   - `priceCents` = Endpreis dieser Zeile (qty × Stückpreis - Rabatt).
5. **Total** = ENDBETRAG nach allen Rabatten.
6. **Wenn Text kein Kassenbon ist**: `isReceipt: false`,
   `notReceiptReason` füllen, alle anderen Felder null.
7. **Wenn Text Manipulationsspuren zeigt** (extrem inkonsistente Schriftarten,
   doppelte Zeilen, unmögliche Werte): `suspiciousManipulation: true`.
8. **ocrConfidence**: deine Selbsteinschätzung 0..1 wie sicher die
   Strukturierung war (NICHT die OCR-Confidence — die kommt von Vision).

Sortiere Items in Reading-Order (top-to-bottom).
"""


def _build_parser_user_prompt(ocr_text: str) -> str:
    return (
        "Hier der OCR-extrahierte Text aus einem Kassenbon. "
        "Strukturiere ihn gemäß JSON-Schema:\n\n"
        f"```\n{ocr_text}\n```"
    )


# ---------------------------------------------------------------------------
# Cloud Vision OCR call
# ---------------------------------------------------------------------------


def _call_cloud_vision(image_bytes: bytes, mime: str) -> tuple[str, list[BoundingBox], int]:
    """Run Cloud Vision DOCUMENT_TEXT_DETECTION on the image.

    Returns (full_text, word_level_bboxes_for_visualization, latency_ms).
    Boxes are returned at WORD granularity initially; we'll re-label them
    later based on which structured field they map to.
    """
    started = time.monotonic()
    image = vision.Image(content=image_bytes)
    # DOCUMENT_TEXT_DETECTION is optimized for documents (vs TEXT_DETECTION
    # which is optimized for sparse signs). Returns hierarchical structure
    # of pages → blocks → paragraphs → words → symbols.
    response = _get_vision_client().document_text_detection(image=image)
    latency_ms = int((time.monotonic() - started) * 1000)

    if response.error and response.error.message:
        raise RuntimeError(f"Cloud Vision error: {response.error.message}")

    full_text = response.full_text_annotation.text if response.full_text_annotation else ""

    # Collect all word-level bounding boxes; we'll re-label them after parsing
    boxes: list[BoundingBox] = []
    if response.full_text_annotation:
        # Find page dimensions for normalization
        if response.full_text_annotation.pages:
            page = response.full_text_annotation.pages[0]
            page_w = max(1, page.width)
            page_h = max(1, page.height)
            for block in page.blocks:
                for para in block.paragraphs:
                    for word in para.words:
                        word_text = "".join(s.text for s in word.symbols)
                        if not word.bounding_box.vertices:
                            continue
                        verts = word.bounding_box.vertices
                        xs = [v.x for v in verts]
                        ys = [v.y for v in verts]
                        if not xs or not ys:
                            continue
                        x0, y0 = min(xs) / page_w, min(ys) / page_h
                        x1, y1 = max(xs) / page_w, max(ys) / page_h
                        boxes.append(BoundingBox(
                            label="word",   # placeholder, re-labeled later
                            text=word_text[:60],
                            confidence=word.confidence or 0.0,
                            x=x0, y=y0, w=x1 - x0, h=y1 - y0,
                        ))

    return full_text, boxes, latency_ms


# ---------------------------------------------------------------------------
# Gemini parser call
# ---------------------------------------------------------------------------


def _call_gemini_parser(ocr_text: str, model: str = "gemini-2.5-flash") -> tuple[Receipt, int, Optional[int], Optional[int], int]:
    """Send OCR text to Gemini for structuring.

    Returns (Receipt, latency_ms, input_tokens, output_tokens, raw_text_len).
    Raises on JSON/schema validation failure.
    """
    started = time.monotonic()
    response = _get_gemini_client().models.generate_content(
        model=model,
        contents=[
            types.Content(
                role="user",
                parts=[types.Part.from_text(text=_build_parser_user_prompt(ocr_text))],
            ),
        ],
        config=types.GenerateContentConfig(
            system_instruction=PARSER_SYSTEM_PROMPT,
            temperature=0.0,
            seed=42,
            response_mime_type="application/json",
            response_schema=Receipt,
        ),
    )
    latency_ms = int((time.monotonic() - started) * 1000)

    raw_text = response.text or ""
    usage = response.usage_metadata
    in_tok = getattr(usage, "prompt_token_count", None) if usage else None
    out_tok = getattr(usage, "candidates_token_count", None) if usage else None

    payload = json.loads(raw_text)
    receipt = Receipt.model_validate(payload)
    return receipt, latency_ms, in_tok, out_tok, len(raw_text)


# ---------------------------------------------------------------------------
# Heuristic re-labeling of CV word boxes once we have the structured Receipt
# ---------------------------------------------------------------------------


def _relabel_boxes(boxes: list[BoundingBox], receipt: Receipt) -> list[BoundingBox]:
    """Re-label CV word boxes based on parsed receipt fields.

    Looks at each word's text and assigns a label by matching against
    receipt.merchant / .totalCents / item names / etc. Reduces noise
    by collapsing words at similar y-coords into one logical box.
    """
    if not boxes or not receipt:
        return boxes

    # Build lookup tables of "what to look for"
    item_words: set[str] = set()
    for item in receipt.items:
        for tok in item.name.split():
            if len(tok) >= 3:
                item_words.add(tok.lower())

    merchant_words: set[str] = set()
    if receipt.merchant:
        for tok in receipt.merchant.split():
            if len(tok) >= 2:
                merchant_words.add(tok.lower())

    total_str = ""
    if receipt.totalCents:
        total_str = f"{receipt.totalCents/100:.2f}".replace(".", ",")

    date_str = receipt.bonDate or ""

    relabeled: list[BoundingBox] = []
    for b in boxes:
        text_lower = b.text.lower().strip(".,:;€")
        new_label = "word"
        if total_str and total_str in b.text:
            new_label = "total"
        elif date_str and date_str.replace("-", ".") in b.text:
            new_label = "date"
        elif text_lower in merchant_words:
            new_label = "merchant"
        elif text_lower in item_words:
            new_label = "item"
        relabeled.append(BoundingBox(
            label=new_label, text=b.text, confidence=b.confidence,
            x=b.x, y=b.y, w=b.w, h=b.h,
        ))
    return relabeled


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


def extract_cv_hybrid(image_path: Path, gemini_model: str = "gemini-2.5-flash") -> CVHybridResult:
    """Process a bon through Cloud Vision OCR + Gemini Flash parser."""
    started_total = time.monotonic()
    name = image_path.name

    try:
        mime, _ = mimetypes.guess_type(str(image_path))
        if not mime:
            mime = "image/jpeg"

        with open(image_path, "rb") as f:
            content = f.read()

        # Stage 1: Cloud Vision OCR
        ocr_text, word_boxes, cv_latency = _call_cloud_vision(content, mime)
        if not ocr_text.strip():
            return CVHybridResult(
                bon=name, ok=False, engine="cv-hybrid/flash",
                promptVersion=CV_HYBRID_VERSION,
                latencyMs=int((time.monotonic() - started_total) * 1000),
                cv_latency_ms=cv_latency, gemini_latency_ms=0,
                pages=1, inputTokens=None, outputTokens=None,
                receipt=None,
                error="Cloud Vision returned no text",
                rawText="",
                boundingBoxes=[],
            )

        # Stage 2: Gemini Flash parser on text
        receipt, gem_latency, in_tok, out_tok, _ = _call_gemini_parser(ocr_text, gemini_model)

        # Apply DACH retailer fallback (same logic as DocAI path)
        if receipt:
            docai_raw_merchant = (receipt.merchant or "").strip()[:80]
            dach_match = _detect_dach_retailer(ocr_text)
            if dach_match:
                canonical, signal = dach_match
                receipt.merchant = canonical
                debug_tag = f"DACH:{signal}"
                if docai_raw_merchant and docai_raw_merchant.lower() != canonical.lower():
                    debug_tag += f" · Gemini raw: «{docai_raw_merchant}»"
                if receipt.merchantSubtitle:
                    receipt.merchantSubtitle = f"{receipt.merchantSubtitle}  ({debug_tag})"
                else:
                    receipt.merchantSubtitle = debug_tag
            elif _looks_like_bad_merchant(receipt.merchant):
                receipt.merchant = "Unknown merchant"
                if docai_raw_merchant:
                    receipt.merchantSubtitle = (
                        f"{receipt.merchantSubtitle}  (Gemini raw: «{docai_raw_merchant}» — not in DACH list)"
                        if receipt.merchantSubtitle
                        else f"Gemini raw: «{docai_raw_merchant}» — not in DACH list"
                    )

        # Re-label word boxes to merchant/total/item where we can
        labeled_boxes = _relabel_boxes(word_boxes, receipt)
        # Filter out unlabeled words for cleaner overlay (keep only structured matches)
        structured_boxes = [b for b in labeled_boxes if b.label != "word"]

        return CVHybridResult(
            bon=name, ok=True, engine="cv-hybrid/flash",
            promptVersion=CV_HYBRID_VERSION,
            latencyMs=int((time.monotonic() - started_total) * 1000),
            cv_latency_ms=cv_latency, gemini_latency_ms=gem_latency,
            pages=1, inputTokens=in_tok, outputTokens=out_tok,
            receipt=receipt, error=None, rawText=None,
            boundingBoxes=structured_boxes,
        )

    except (json.JSONDecodeError, ValidationError) as e:
        return CVHybridResult(
            bon=name, ok=False, engine="cv-hybrid/flash",
            promptVersion=CV_HYBRID_VERSION,
            latencyMs=int((time.monotonic() - started_total) * 1000),
            cv_latency_ms=0, gemini_latency_ms=0,
            pages=1, inputTokens=None, outputTokens=None,
            receipt=None,
            error=f"parse: {e}",
            rawText=None,
            boundingBoxes=[],
        )
    except Exception as e:  # noqa: BLE001
        logger.exception("CV hybrid extraction failed for %s", name)
        return CVHybridResult(
            bon=name, ok=False, engine="cv-hybrid/flash",
            promptVersion=CV_HYBRID_VERSION,
            latencyMs=int((time.monotonic() - started_total) * 1000),
            cv_latency_ms=0, gemini_latency_ms=0,
            pages=1, inputTokens=None, outputTokens=None,
            receipt=None,
            error=f"{type(e).__name__}: {e}",
            rawText=None,
            boundingBoxes=[],
        )


def estimate_cv_hybrid_cents(pages: int, input_tokens: Optional[int], output_tokens: Optional[int]) -> Optional[float]:
    """Cost in cents for one CV+Gemini call."""
    if pages <= 0:
        return None
    p = CV_PRICING
    cv_cost_usd = pages * p["vision_per_page_usd"]
    gemini_cost_usd = 0.0
    if input_tokens:
        gemini_cost_usd += (input_tokens / 1_000_000.0) * p["gemini_in_per_mtok"]
    if output_tokens:
        gemini_cost_usd += (output_tokens / 1_000_000.0) * p["gemini_out_per_mtok"]
    return round((cv_cost_usd + gemini_cost_usd) * 100, 4)
