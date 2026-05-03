"""
Google Cloud Document AI — Expense Parser integration.

Wraps the Document AI Expense Parser into the same `Receipt` Pydantic
schema used by the Gemini path, so the dashboard can compare both
engines side-by-side on identical bons.

Key properties (vs Gemini):
  - **Deterministic.** Same image bytes → same JSON, every call.
  - **Specialized** — pre-trained on expense / receipt structures incl.
    DACH supermarket layouts.
  - **Per-field confidence scores** built-in.
  - **Pricing:** ~$0.10/page for Expense Parser, ~$0.03 for Custom
    Extractor, ~$0.0015 for OCR-only Form Parser.

Setup:
  See README §Document AI for the complete walkthrough.
  Required env vars:
      GOOGLE_CLOUD_PROJECT=markendetektive-895f7
      DOCUMENTAI_LOCATION=eu
      DOCUMENTAI_PROCESSOR_ID=<id from Console>
  Auth (one of):
      a) `gcloud auth application-default login`  (recommended for dev)
      b) GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json

References:
  - https://cloud.google.com/document-ai/docs/processors-list#expense
  - https://cloud.google.com/document-ai/docs/process-documents-client-libraries
"""

from __future__ import annotations

import logging
import mimetypes
import os
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from google.api_core.client_options import ClientOptions
from google.cloud import documentai_v1 as documentai

from schema import Receipt, ReceiptItem


logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Pricing (USD per page) — used by dashboard cost display.
# Update if Google publishes new pricing tiers.
# ---------------------------------------------------------------------------

DOCAI_PRICING = {
    "expense":  {"per_page_usd": 0.10},  # Expense Parser, specialized
    "form":     {"per_page_usd": 0.03},  # Form Parser
    "ocr":      {"per_page_usd": 0.0015},  # Plain OCR
    "custom":   {"per_page_usd": 0.03},  # Custom Extractor
}


# ---------------------------------------------------------------------------
# Result type — mirrors validate.ExtractResult
# ---------------------------------------------------------------------------


@dataclass
class BoundingBox:
    """Pixel-coordinate bounding box (normalized 0-1) of an entity in the page."""
    label: str          # 'item', 'total', 'merchant', 'date', 'subtotal', 'discount'
    text: str           # what was read at this location (truncated)
    confidence: float
    # Normalized (0-1) coordinates — convert with image w/h on the client side
    x: float
    y: float
    w: float
    h: float


@dataclass
class DocAIResult:
    bon: str
    ok: bool
    engine: str          # "docai/expense"
    promptVersion: str   # "n/a — DocAI is pre-trained, not prompted"
    latencyMs: int
    pages: int           # Document AI bills per page
    receipt: Optional[Receipt]
    error: Optional[str]
    rawText: Optional[str]  # On error: dump raw doc.text for debugging
    docConfidence: Optional[float]  # Average entity confidence
    boundingBoxes: list[BoundingBox]   # for visual overlay in the dashboard


# ---------------------------------------------------------------------------
# Client cache — opening a Document AI client requires gRPC channel setup,
# don't recreate per-call.
# ---------------------------------------------------------------------------

_client: Optional[documentai.DocumentProcessorServiceClient] = None
_client_endpoint: Optional[str] = None


def get_client(location: str) -> documentai.DocumentProcessorServiceClient:
    global _client, _client_endpoint
    endpoint = f"{location}-documentai.googleapis.com"
    if _client is None or _client_endpoint != endpoint:
        _client = documentai.DocumentProcessorServiceClient(
            client_options=ClientOptions(api_endpoint=endpoint)
        )
        _client_endpoint = endpoint
    return _client


def get_processor_name(project: str, location: str, processor_id: str) -> str:
    return f"projects/{project}/locations/{location}/processors/{processor_id}"


# ---------------------------------------------------------------------------
# Entity → Receipt mapping
# ---------------------------------------------------------------------------


def _to_cents(value: str | None) -> Optional[int]:
    """Normalize a money string ('1,29 €' / '1.29' / '129') to integer cents."""
    if value is None:
        return None
    s = str(value).strip()
    if not s:
        return None
    # Remove currency, whitespace
    for ch in ("€", "EUR", "$", "USD", "CHF", " "):
        s = s.replace(ch, "")
    # German format: "1.234,56" → "1234.56" — convert thousand separator + decimal
    if "," in s and "." in s:
        # Both separators: "1.234,56" — strip dots, convert comma
        s = s.replace(".", "").replace(",", ".")
    elif "," in s:
        # Only comma: "1,29" → "1.29"
        s = s.replace(",", ".")
    s = s.replace("−", "-")  # Unicode minus
    try:
        f = float(s)
        return int(round(f * 100))
    except ValueError:
        return None


def _to_iso_date(value: str | None) -> Optional[str]:
    """Best-effort normalize various date formats to YYYY-MM-DD."""
    if not value:
        return None
    s = str(value).strip()
    # Already ISO
    if len(s) == 10 and s[4] == "-" and s[7] == "-":
        return s
    # German DD.MM.YYYY
    if len(s) == 10 and s[2] == "." and s[5] == ".":
        return f"{s[6:10]}-{s[3:5]}-{s[0:2]}"
    # German DD.MM.YY
    if len(s) == 8 and s[2] == "." and s[5] == ".":
        return f"20{s[6:8]}-{s[3:5]}-{s[0:2]}"
    # Slash variants
    if len(s) == 10 and s[2] == "/" and s[5] == "/":
        # Could be DD/MM/YYYY or MM/DD/YYYY — DACH = DD/MM
        return f"{s[6:10]}-{s[3:5]}-{s[0:2]}"
    # Already-ISO with time appended (e.g. "2024-10-09T16:25:00")
    if len(s) >= 10 and s[4] == "-" and s[7] == "-":
        return s[:10]
    return s  # Return as-is; downstream handles parse failures


def _to_hh_mm(value: str | None) -> Optional[str]:
    """Normalize various time formats to HH:MM."""
    if not value:
        return None
    s = str(value).strip()
    if len(s) >= 5 and s[2] == ":":
        return s[:5]
    return s


def _entity_text(entity: documentai.Document.Entity) -> str:
    """Extract the plain text of an entity, falling back to mention_text."""
    return (entity.normalized_value.text if entity.normalized_value and entity.normalized_value.text
            else entity.mention_text or "")


# ---------------------------------------------------------------------------
# DACH retailer recognition.
#
# We DON'T rely on DocAI's supplier_name field — it's wrong on ~30% of DACH
# bons because the model is global-trained and gets confused by:
#   - TSE-Signatur base64 strings (DACH-specific)
#   - Barcode artifacts above the receipt header
#   - Receipts where the first line is an item, not the merchant
#
# Strategy: scan the OCR text for known retailer signatures. Two layers:
#   1) Header/address mentions ("LIDL", "REWE", "Kaufland", ...)
#   2) Receipt-internal codes ("LDL-" for LIDL TSE, "KFL-" for Kaufland, ...)
#   3) Private-label product names that only appear at one retailer
#      ("MILBONA" → LIDL, "JA!" → REWE, "K-CLASSIC" → Kaufland, ...)
#
# Order matters: more-specific patterns first (ALDI SÜD before ALDI).
# ---------------------------------------------------------------------------

DACH_RETAILERS = [
    # (canonical, header_patterns, receipt_code_prefixes, private_label_brands)
    # All patterns matched case-insensitively.
    ("ALDI SÜD",  ["aldi süd", "aldi sued"], ["asd-", "ald-sd"],  []),
    ("ALDI Nord", ["aldi nord"],              ["asn-", "ald-nd"],  []),
    ("ALDI",      ["aldi"],                   ["aldi-"],            ["milsani", "tandil", "alpensahne"]),
    ("LIDL",      ["lidl"],                   ["ldl-"],             ["milbona", "freeway", "chef select",
                                                                     "italiamo", "vitafit", "deluxe",
                                                                     "snack day", "favorina", "lupilu"]),
    ("Kaufland",  ["kaufland"],               ["kfl-"],             ["k-classic", "k classic", "k-bio",
                                                                     "k-purland", "k-favourites", "k-take it",
                                                                     "klc.", "klc "]),
    ("REWE",      ["rewe"],                   ["rew-"],             ["ja!", "rewe bio", "rewe beste wahl",
                                                                     "rewe regional", "smoothie rewe",
                                                                     "rewe feine welt"]),
    ("EDEKA",     ["edeka", "e-center", "e center"], ["edk-"],     ["gut&günstig", "gut & günstig",
                                                                     "edeka bio", "edeka mein land",
                                                                     "g&g ", "g & g", "elkos"]),
    ("Penny",     ["penny-markt", "penny markt", "penny"], ["pny-", "penny-"], ["san fabio", "rispando",
                                                                                "ich liebe es"]),
    ("Netto",     ["netto marken-discount", "netto-markendiscount", "netto-marken", "netto"],
                                              ["ntm-", "ntt-"],     ["bio sonne", "ja-", "viva vital"]),
    ("Norma",     ["norma"],                  ["nrm-"],             ["selection", "san fabio"]),
    ("real",      ["real,-", "real-"],        ["rl-"],              ["tip", "real quality"]),
    ("Globus",    ["globus"],                 ["glb-"],             ["natur pur"]),
    ("tegut",     ["tegut"],                  ["tgt-"],             ["tegut bio"]),
    ("HIT",       ["hit-markt", "hit markt"], ["hit-"],             []),
    ("Müller",    ["müller drogerie", "mueller drogerie", "müller "], ["mdm-"], []),
    ("dm",        ["dm-drogerie markt", "dm drogerie markt"], ["dmm-"], ["alverde", "balea", "dmbio"]),
    ("Rossmann",  ["rossmann"],               ["rsm-"],             ["alterra", "ener bio", "isana"]),
    ("Budni",     ["budni"],                  ["bdn-"],             []),
    ("Famila",    ["famila"],                 ["fam-"],             []),
    ("Combi",     ["combi"],                  ["cmb-"],             []),
    ("Marktkauf", ["marktkauf"],              ["mkk-"],             []),
    ("Wasgau",    ["wasgau"],                 ["wsg-"],             []),
    ("Spar",      ["spar markt", "spar express", "spar  "],  ["spr-"], []),  # AT
    ("Billa",     ["billa"],                  ["bil-"],             ["clever"]),  # AT
    ("Hofer",     ["hofer"],                  ["hof-"],             []),  # AT
    ("Migros",    ["migros"],                 ["mgr-"],             ["m-classic", "m-budget"]),  # CH
    ("Coop",      ["coop "],                  ["cop-"],             ["prix garantie", "qualité&prix"]),  # CH
    ("Denner",    ["denner"],                 ["dnr-"],             []),  # CH
]


def _detect_dach_retailer(doc_text: str) -> Optional[tuple[str, str]]:
    """Scan OCR text for a known DACH retailer using 3 signal layers.

    Returns (canonical_name, signal_used) or None.
    signal_used is "header" | "code" | "brand" — useful for debugging.

    Penny→REWE bug: Penny is a REWE-Group subsidiary. Penny receipts contain
    "REWE" in the TSE serial line ("Seriennummer Kasse: REWE:b4..."). If we
    pick first-list-match, REWE wins over Penny. Fix: pick the retailer
    whose match occurs EARLIEST in doc_text — actual receipt headers are at
    the very top, TSE blocks are way further down.
    """
    if not doc_text:
        return None
    head = doc_text[:1500].lower()
    full = doc_text.lower()

    # Layer 1: header/address mention — strongest signal.
    # Find ALL header matches with their positions, return earliest.
    header_hits: list[tuple[int, str]] = []
    for canonical, headers, _codes, _brands in DACH_RETAILERS:
        best_pos = None
        for pat in headers:
            pos = head.find(pat)
            if pos >= 0 and (best_pos is None or pos < best_pos):
                best_pos = pos
        if best_pos is not None:
            header_hits.append((best_pos, canonical))
    if header_hits:
        header_hits.sort()  # by position
        return (header_hits[0][1], "header")

    # Layer 2: receipt-internal codes (TSE serial prefixes etc.) — earliest wins.
    code_hits: list[tuple[int, str]] = []
    for canonical, _headers, codes, _brands in DACH_RETAILERS:
        best_pos = None
        for code in codes:
            pos = full.find(code)
            if pos >= 0 and (best_pos is None or pos < best_pos):
                best_pos = pos
        if best_pos is not None:
            code_hits.append((best_pos, canonical))
    if code_hits:
        code_hits.sort()
        return (code_hits[0][1], "code")

    # Layer 3: private-label product brands — earliest wins.
    brand_hits: list[tuple[int, str]] = []
    for canonical, _headers, _codes, brands in DACH_RETAILERS:
        best_pos = None
        for brand in brands:
            pos = full.find(brand)
            if pos >= 0 and (best_pos is None or pos < best_pos):
                best_pos = pos
        if best_pos is not None:
            brand_hits.append((best_pos, canonical))
    if brand_hits:
        brand_hits.sort()
        return (brand_hits[0][1], "brand")

    return None


# Kept for backward compat / introspection. Always returns False now —
# we no longer trust DocAI's supplier_name; we always prefer DACH retailer
# detection if it returns anything.
def _looks_like_bad_merchant(name: Optional[str]) -> bool:
    if not name:
        return True
    s = name.strip()
    if len(s) < 2:
        return True
    return False


def _build_line_item(entity: documentai.Document.Entity) -> Optional[ReceiptItem]:
    """Build a ReceiptItem from a `line_item` entity (which has nested properties)."""
    name = None
    qty = 1.0
    price_cents = None
    unit_price_cents = None

    for prop in entity.properties:
        ptype = prop.type_
        ptext = _entity_text(prop)
        if ptype == "line_item/description":
            name = ptext.strip()
        elif ptype == "line_item/quantity":
            try:
                qty = float(ptext.replace(",", "."))
            except ValueError:
                qty = 1.0
        elif ptype == "line_item/amount":
            price_cents = _to_cents(ptext)
        elif ptype == "line_item/unit_price":
            unit_price_cents = _to_cents(ptext)

    if not name:
        return None
    if price_cents is None:
        # Some bons only list unit price + qty; derive
        if unit_price_cents is not None:
            price_cents = int(round(unit_price_cents * qty))
        else:
            return None  # Skip lines we can't price

    return ReceiptItem(
        name=name,
        qty=qty,
        priceCents=price_cents,
        unitPriceCents=unit_price_cents,
        category=None,
    )


def _entity_bbox(entity: documentai.Document.Entity, doc: documentai.Document) -> Optional[tuple[float, float, float, float]]:
    """Pull normalized (x, y, w, h) for an entity by walking its page anchors.

    Returns None if entity has no anchor.
    """
    if not entity.page_anchor or not entity.page_anchor.page_refs:
        return None
    page_ref = entity.page_anchor.page_refs[0]
    poly = page_ref.bounding_poly
    if not poly:
        return None

    if poly.normalized_vertices:
        verts = [(v.x, v.y) for v in poly.normalized_vertices]
    elif poly.vertices and len(doc.pages) > 0:
        page = doc.pages[int(page_ref.page) if page_ref.page else 0]
        page_w = page.dimension.width if page.dimension else 1
        page_h = page.dimension.height if page.dimension else 1
        verts = [(v.x / page_w, v.y / page_h) for v in poly.vertices]
    else:
        return None

    if not verts:
        return None
    xs = [v[0] for v in verts]
    ys = [v[1] for v in verts]
    x0, y0 = min(xs), min(ys)
    x1, y1 = max(xs), max(ys)
    return (x0, y0, x1 - x0, y1 - y0)


def _bbox_from_entity(entity: documentai.Document.Entity, doc: documentai.Document, label: str) -> Optional[BoundingBox]:
    pos = _entity_bbox(entity, doc)
    if not pos:
        return None
    text = _entity_text(entity)
    return BoundingBox(
        label=label,
        text=text[:60],
        confidence=float(entity.confidence) if entity.confidence else 0.0,
        x=pos[0], y=pos[1], w=pos[2], h=pos[3],
    )


def _doc_to_receipt(doc: documentai.Document) -> tuple[Receipt, float, list[BoundingBox]]:
    """Map a parsed Document AI Document into our Receipt schema + bbox list.

    Returns (Receipt, avg_confidence, bounding_boxes).
    """
    merchant: Optional[str] = None
    merchant_subtitle: Optional[str] = None
    bon_date: Optional[str] = None
    bon_time: Optional[str] = None
    total_cents: Optional[int] = None
    subtotal_cents: Optional[int] = None
    payment_method: Optional[str] = None
    items: list[ReceiptItem] = []

    confidences: list[float] = []
    boxes: list[BoundingBox] = []

    for entity in doc.entities:
        etype = entity.type_
        etext = _entity_text(entity)
        if entity.confidence:
            confidences.append(float(entity.confidence))

        if etype == "supplier_name":
            merchant = etext.strip() or merchant
            box = _bbox_from_entity(entity, doc, "merchant")
            if box:
                boxes.append(box)
        elif etype == "supplier_address":
            merchant_subtitle = etext.strip() or merchant_subtitle
        elif etype == "supplier_phone":
            if etext and (not merchant_subtitle or etext not in merchant_subtitle):
                merchant_subtitle = (merchant_subtitle + " · " + etext.strip()
                                     if merchant_subtitle else etext.strip())
        elif etype == "receipt_date" or etype == "purchase_date":
            bon_date = _to_iso_date(etext)
            box = _bbox_from_entity(entity, doc, "date")
            if box:
                boxes.append(box)
        elif etype == "purchase_time":
            bon_time = _to_hh_mm(etext)
        elif etype == "total_amount":
            total_cents = _to_cents(etext)
            box = _bbox_from_entity(entity, doc, "total")
            if box:
                boxes.append(box)
        elif etype == "net_amount" or etype == "total_tax_amount":
            pass
        elif etype == "subtotal_amount":
            subtotal_cents = _to_cents(etext)
            box = _bbox_from_entity(entity, doc, "subtotal")
            if box:
                boxes.append(box)
        elif etype == "payment_type":
            payment_method = etext.strip()
        elif etype == "line_item":
            li = _build_line_item(entity)
            if li:
                items.append(li)
                box = _bbox_from_entity(entity, doc, "item")
                if box:
                    boxes.append(box)

    avg_conf = (sum(confidences) / len(confidences)) if confidences else None

    # ---------------------------------------------------------------
    # Merchant resolution — ALWAYS run DACH retailer detection first.
    # DocAI's supplier_name is unreliable (~30% wrong on DACH bons:
    # TSE-base64 artifacts, barcode noise, first-item misclassification).
    # Use DACH detection if it finds anything, fall back to DocAI's
    # supplier_name only when DACH detection comes up empty.
    # ---------------------------------------------------------------
    docai_raw_merchant = (merchant or "").strip().replace("\n", " ")[:80]
    dach_match = _detect_dach_retailer(doc.text or "")
    if dach_match:
        canonical, signal = dach_match
        merchant = canonical
        # Tag the source so we can see in the UI which signal triggered
        debug_tag = f"DACH:{signal}"
        if docai_raw_merchant and docai_raw_merchant.lower() != canonical.lower():
            debug_tag += f" · DocAI raw: «{docai_raw_merchant}»"
        if merchant_subtitle:
            merchant_subtitle = f"{merchant_subtitle}  ({debug_tag})"
        else:
            merchant_subtitle = debug_tag
    elif _looks_like_bad_merchant(merchant):
        # DACH unrecognized AND DocAI supplier_name looks empty/garbage
        merchant = "Unknown merchant"
        if docai_raw_merchant:
            merchant_subtitle = (
                f"{merchant_subtitle}  (DocAI raw: «{docai_raw_merchant}» — not in DACH list)"
                if merchant_subtitle
                else f"DocAI raw: «{docai_raw_merchant}» — not in DACH list"
            )
    # else: keep DocAI's supplier_name as-is (it looked plausible and
    # we don't have a DACH match to override it).

    return (
        Receipt(
            isReceipt=True,
            notReceiptReason=None,
            merchant=merchant,
            merchantSubtitle=merchant_subtitle,
            bonDate=bon_date,
            bonTime=bon_time,
            items=items,
            subtotalCents=subtotal_cents,
            totalCents=total_cents,
            paymentMethod=payment_method,
            suspiciousManipulation=False,
            manipulationNotes=None,
            ocrConfidence=avg_conf,
        ),
        avg_conf or 0.0,
        boxes,
    )


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


def extract_docai(image_path: Path) -> DocAIResult:
    """Process a bon through Document AI Expense Parser.

    Reads env config:
      GOOGLE_CLOUD_PROJECT   (required)
      DOCUMENTAI_LOCATION    (required, typically 'eu' or 'us')
      DOCUMENTAI_PROCESSOR_ID (required)
    Auth via ADC or GOOGLE_APPLICATION_CREDENTIALS.
    """
    started = time.monotonic()
    name = image_path.name

    project = os.environ.get("GOOGLE_CLOUD_PROJECT")
    location = os.environ.get("DOCUMENTAI_LOCATION", "eu")
    processor_id = os.environ.get("DOCUMENTAI_PROCESSOR_ID")

    if not project or not processor_id:
        return DocAIResult(
            bon=name,
            ok=False,
            engine="docai/expense",
            promptVersion="n/a",
            latencyMs=0,
            pages=0,
            receipt=None,
            error=(
                "Missing env: need GOOGLE_CLOUD_PROJECT and "
                "DOCUMENTAI_PROCESSOR_ID. See README §Document AI."
            ),
            rawText=None,
            docConfidence=None,
            boundingBoxes=[],
        )

    try:
        client = get_client(location)
        processor_name = get_processor_name(project, location, processor_id)

        mime, _ = mimetypes.guess_type(str(image_path))
        if not mime:
            mime = "image/jpeg"

        with open(image_path, "rb") as f:
            content = f.read()

        raw_doc = documentai.RawDocument(content=content, mime_type=mime)
        request = documentai.ProcessRequest(name=processor_name, raw_document=raw_doc)

        response = client.process_document(request=request)
        doc = response.document

        receipt, avg_conf, boxes = _doc_to_receipt(doc)
        latency_ms = int((time.monotonic() - started) * 1000)

        return DocAIResult(
            bon=name,
            ok=True,
            engine="docai/expense",
            promptVersion="n/a",
            latencyMs=latency_ms,
            pages=len(doc.pages) or 1,
            receipt=receipt,
            error=None,
            rawText=None,
            docConfidence=avg_conf,
            boundingBoxes=boxes,
        )
    except Exception as e:  # noqa: BLE001 — capture per-bon errors cleanly
        latency_ms = int((time.monotonic() - started) * 1000)
        logger.exception("Document AI extraction failed for %s", name)
        return DocAIResult(
            bon=name,
            ok=False,
            engine="docai/expense",
            promptVersion="n/a",
            latencyMs=latency_ms,
            pages=0,
            receipt=None,
            error=f"{type(e).__name__}: {e}",
            rawText=None,
            docConfidence=None,
            boundingBoxes=[],
        )


def estimate_docai_cents(pages: int, processor_kind: str = "expense") -> Optional[float]:
    """Cost in cents for a Document AI call (per-page pricing)."""
    if pages <= 0:
        return None
    p = DOCAI_PRICING.get(processor_kind)
    if not p:
        return None
    return round(pages * p["per_page_usd"] * 100, 4)
