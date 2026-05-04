"""
Phase-0 OCR Validation Dashboard.

Streamlit-based local web UI for testing receipt-OCR engines.
Supports two engines side-by-side:
  - Gemini (2.5 Flash / Flash-Lite / Pro) — LLM-based, fast, non-deterministic
  - Document AI Expense Parser — specialized, deterministic, more expensive

Run:
    cd tools/cashback-ocr-validation
    source .venv/bin/activate
    streamlit run dashboard.py

Then open http://localhost:8501

Total isolation: own venv (`tools/cashback-ocr-validation/.venv`),
own port (8501), own deps. Does NOT touch the React Native app, the
Firestore project, or anything in `app/` / `cloud-functions/`.
"""

from __future__ import annotations

import hashlib
import json
import os
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from io import BytesIO
from pathlib import Path
from typing import Optional

import streamlit as st
from dotenv import load_dotenv
from google import genai
from PIL import Image, ImageDraw, ImageFont

from prompts import VERSION as PROMPT_VERSION
from validate import PRICING as GEMINI_PRICING, estimate_cents, extract_one
from docai import DOCAI_PRICING, extract_docai, estimate_docai_cents
from cv_hybrid import CV_PRICING, extract_cv_hybrid, estimate_cv_hybrid_cents, CV_HYBRID_VERSION
from image_prep import preprocess as preprocess_image

# Cache-busting key. Bump this whenever extraction logic, prompts,
# preprocessing, or merchant fallback changes — invalidates all cached
# extractions in one shot so users don't see stale results from old code.
_CACHE_VERSION = "v8-2026-05-03-parallel-resize"

# Default upper bound on image dimension after preprocessing.
# Lower = faster (fewer bytes uploaded, less server-side work).
# 2000 is a good default for receipts; small text remains readable.
_DEFAULT_MAX_DIM = 2000

# Cap on parallel workers for batch processing.
# Each worker fires 1-3 API calls (vision/gemini, optionally docai).
# Cloud Vision quota = 1800/min, Gemini Flash plenty. 8 is conservative
# and keeps the UI from spinning up dozens of threads on huge uploads.
_MAX_PARALLEL_WORKERS = 8

# ---------------------------------------------------------------------------
# Page config
# ---------------------------------------------------------------------------

load_dotenv()

st.set_page_config(
    page_title="Cashback OCR — Phase 0",
    page_icon="🧾",
    layout="wide",
    initial_sidebar_state="expanded",
)

st.markdown(
    """
    <style>
      .block-container { padding-top: 2rem; padding-bottom: 4rem; max-width: 1400px; }
      .stat-card {
        background: #f6f8fa; border-radius: 12px; padding: 14px 18px;
        border: 1px solid #e1e4e8;
      }
      .stat-num { font-size: 28px; font-weight: 800; color: #0d1117; line-height: 1; }
      .stat-label { font-size: 11px; font-weight: 600; color: #57606a;
        text-transform: uppercase; letter-spacing: 0.04em; margin-top: 4px; }
      .gate-ok { color: #1a7f37; font-weight: 700; }
      .gate-warn { color: #9a6700; font-weight: 700; }
      .gate-fail { color: #cf222e; font-weight: 700; }
      .item-row {
        display: flex; justify-content: space-between;
        padding: 6px 8px; border-bottom: 1px solid #f0f1f3;
        font-size: 13px;
      }
      .item-name { color: #24292f; }
      .item-price { color: #57606a; font-variant-numeric: tabular-nums; }
      .meta-pill {
        display: inline-block; padding: 3px 10px; border-radius: 999px;
        background: #ddf4ff; color: #0969da; font-size: 11px;
        font-weight: 700; margin-right: 6px; letter-spacing: 0.02em;
      }
      .meta-pill-warn { background: #fff8c5; color: #9a6700; }
      .meta-pill-bad { background: #ffebe9; color: #cf222e; }
      .engine-badge {
        display: inline-block; padding: 4px 12px; border-radius: 8px;
        background: #1f6feb; color: white; font-weight: 700;
        font-size: 12px; letter-spacing: 0.04em;
      }
      .engine-badge-docai { background: #8250df; }
    </style>
    """,
    unsafe_allow_html=True,
)


# ---------------------------------------------------------------------------
# Engine config
# ---------------------------------------------------------------------------

ENGINES = {
    "gemini":    "🤖 Gemini direct (LLM auf Bild, schnell, non-deterministisch)",
    "docai":     "📄 Document AI Expense Parser (spezialisiert, $0,05/page)",
    "cv-hybrid": "🔀 Cloud Vision + Gemini Flash Parser (Hybrid, ~$0,003/page)",
}


# ---------------------------------------------------------------------------
# Sidebar — controls
# ---------------------------------------------------------------------------

with st.sidebar:
    st.markdown("### ⚙️ Engine")

    engine = st.radio(
        label="OCR Engine",
        options=list(ENGINES.keys()),
        format_func=lambda k: ENGINES[k],
        index=list(ENGINES.keys()).index("cv-hybrid"),  # Default = Hybrid (best $/quality)
        label_visibility="collapsed",
    )

    if engine == "gemini":
        model = st.selectbox(
            "Modell",
            options=sorted(GEMINI_PRICING.keys()),
            index=sorted(GEMINI_PRICING.keys()).index("gemini-2.5-flash"),
            help="flash = Default. flash-lite = günstigster. pro = höchste Quali.",
        )
        st.caption(
            f"`{model}` pricing per 1M tokens: "
            f"in ${GEMINI_PRICING[model]['in']} / out ${GEMINI_PRICING[model]['out']}"
        )
        st.caption(f"Prompt version: `{PROMPT_VERSION}`, temperature=0, seed=42")
    elif engine == "docai":
        model = "docai/expense"
        proc_id = os.environ.get("DOCUMENTAI_PROCESSOR_ID", "")
        proc_loc = os.environ.get("DOCUMENTAI_LOCATION", "eu")
        proc_proj = os.environ.get("GOOGLE_CLOUD_PROJECT", "")
        if proc_id and proc_proj:
            st.caption(f"Processor: `{proc_id}` in `{proc_loc}`")
            st.caption(f"Project: `{proc_proj}`")
            st.caption("Pricing: $0,05 / page (Expense Parser, 2025-Preise)")
        else:
            st.error(
                "DocAI nicht konfiguriert. Setze in `.env`:\n\n"
                "`GOOGLE_CLOUD_PROJECT`, `DOCUMENTAI_LOCATION`, `DOCUMENTAI_PROCESSOR_ID`\n\n"
                "Siehe README §Document AI."
            )
    else:  # cv-hybrid
        model = "cv-hybrid/flash"
        st.caption(
            "Cloud Vision OCR (deterministisch) → Gemini 2.5 Flash strukturiert."
        )
        st.caption(
            f"Pricing: ${CV_PRICING['vision_per_page_usd']}/page Vision + Gemini-Flash text"
        )
        st.caption(f"Version: `{CV_HYBRID_VERSION}`, temperature=0, seed=42")
        if not os.environ.get("GEMINI_API_KEY"):
            st.error("`GEMINI_API_KEY` muss in `.env` gesetzt sein.")
        if not os.environ.get("GOOGLE_CLOUD_PROJECT"):
            st.warning(
                "`GOOGLE_CLOUD_PROJECT` nicht gesetzt — Vision auth nutzt ADC. "
                "Falls Auth fehlschlägt: `gcloud auth application-default login`"
            )

    # Auto-escalate toggle: only meaningful for non-DocAI engines
    if engine != "docai":
        escalate = st.checkbox(
            "🚨 Auto-Escalate to DocAI on Δ ≠ 0",
            value=True,
            help="Wenn die primäre Engine Σ items ≠ Total liefert (Reconciliation "
                 "fehlschlägt), automatisch DocAI Expense Parser als Backup aufrufen. "
                 "Cost-Aufschlag nur bei den Bons die's brauchen.",
        )
    else:
        escalate = False  # DocAI is already the most accurate, no escalation needed

    st.markdown("---")
    st.markdown("### 🖼 Image Preprocessing")
    preprocess_enabled = st.checkbox(
        "Auto-deskew + crop bon (vor OCR-Send)",
        value=True,
        help="Erkennt die 4 Ecken des Bons, korrigiert die Perspektive, "
             "schneidet den Hintergrund weg. Schickt das saubere Bild an OCR. "
             "Cache invalidiert wenn umgeschaltet.",
    )
    show_overlay = st.checkbox(
        "OCR-Overlay anzeigen (Bounding Boxes)",
        value=True,
        help="Zeichnet farbige Boxen auf das Bild — eine pro erkanntem "
             "Item / Total / Merchant / Date. Nur DocAI liefert Boxen.",
    )

    max_dim = st.select_slider(
        "Max image dimension (px)",
        options=[1200, 1600, 2000, 2500, 3500],
        value=_DEFAULT_MAX_DIM,
        help="Längste Kante des Bildes vor OCR-Send. Kleiner = schneller "
             "Upload + schnellere API-Calls. 2000 ist ein guter Default für "
             "Bons (Text bleibt scharf). 1200-1600 für maximale Speed, "
             "2500-3500 wenn Bons besonders kleine Schrift haben.",
    )

    st.markdown("**Quality Enhancements** (alle $0, alle einzeln aktivierbar)")
    enable_clahe = st.checkbox(
        "CLAHE — Kontrast-Boost",
        value=False,
        help="Adaptives Histogramm-Equalization. Big Win für verblasste "
             "Thermal-Bons (Penny/Aldi nach Wallet-Aufenthalt).",
    )
    enable_denoise = st.checkbox(
        "Denoise — JPEG-Artefakte raus",
        value=False,
        help="Non-Local Means Denoising. Glättet Bildrauschen, behält Kanten. "
             "Langsamer (~1-2 s/Bon zusätzlich).",
    )
    enable_threshold = st.checkbox(
        "B&W Adaptive Threshold",
        value=False,
        help="Konvertiert auf reines Schwarz-Weiß mit lokalem Threshold. "
             "Killt Hintergrund-Schatten, hilft enorm bei Tisch-Photos. "
             "VORSICHT: Verliert Farbinfo, manchmal hilft es OCR, manchmal nicht — ausprobieren.",
    )

    st.markdown("---")
    st.markdown("### 📊 Decision Gates")
    st.markdown(
        """
        - **OK-Quote** ≥ 95 %
        - **Δ ≤ 0,05 €** ≥ 95 %
        - **Cost / Bon** ≤ 0,3 ¢
        - **Determinismus**: same bon → same JSON
        """
    )

    st.markdown("---")
    if st.button("🗑 Cache leeren (forciert frische API-Calls)"):
        st.cache_data.clear()
        st.success("Cache geleert. Re-Upload triggert frische Calls.")

    st.caption(
        "Local-only Tool. Bons leave **only** to the chosen engine's API. "
        "Nothing is written to Firestore, App, or any prod system."
    )


# ---------------------------------------------------------------------------
# Header
# ---------------------------------------------------------------------------

st.markdown("# 🧾 Cashback OCR — Phase 0 Validation")

engine_badge_class = "engine-badge engine-badge-docai" if engine == "docai" else "engine-badge"
engine_label = "DOCUMENT AI" if engine == "docai" else f"GEMINI · {model}"
st.markdown(
    f"<span class='{engine_badge_class}'>{engine_label}</span>",
    unsafe_allow_html=True,
)
st.markdown(
    "Drag receipts in, see what the engine extracts. Switch engines in the "
    "sidebar to compare on the same bons. **No app/Firestore impact.**"
)


# ---------------------------------------------------------------------------
# Uploader
# ---------------------------------------------------------------------------

uploaded = st.file_uploader(
    "Bons hochladen (jpg, png, webp, heic, pdf — beliebig viele)",
    type=["jpg", "jpeg", "png", "webp", "heic", "heif", "pdf"],
    accept_multiple_files=True,
)


# ---------------------------------------------------------------------------
# Client cache (don't recreate per-run)
# ---------------------------------------------------------------------------


@st.cache_resource
def get_gemini_client() -> genai.Client:
    return genai.Client(api_key=os.environ["GEMINI_API_KEY"])


# ---------------------------------------------------------------------------
# Per-bon processing — cache is keyed by (bytes_hash, engine, model).
# Same bon + same engine + same model → cached, no second API call.
# Switch engine or model → fresh call.
# ---------------------------------------------------------------------------


@st.cache_data(show_spinner=False, max_entries=400)
def process(
    file_bytes: bytes,
    file_name: str,
    engine: str,
    model: str,
    preprocess_enabled: bool,
    enable_clahe: bool = False,
    enable_denoise: bool = False,
    enable_threshold: bool = False,
    escalate: bool = False,
    max_dim: int = _DEFAULT_MAX_DIM,
    code_version: str = _CACHE_VERSION,
) -> dict:
    """Wrap engine extraction with bytes-cached invocation.

    Returns a uniform result dict regardless of engine.
    Cache key includes ALL flags + code_version — toggling any triggers
    fresh API calls.
    """
    bytes_hash = hashlib.sha256(file_bytes).hexdigest()[:16]
    _ = code_version  # only used for cache-key invalidation

    # Run image preprocessing if enabled.
    # The 3 quality enhancements (CLAHE/Denoise/Threshold) only fire if
    # the geometric preprocess is also enabled — they share the same pipeline.
    prep_info: dict = {"applied": False}
    if preprocess_enabled or enable_clahe or enable_denoise or enable_threshold:
        try:
            prep = preprocess_image(
                file_bytes,
                max_dim=max_dim,
                enable_clahe=enable_clahe,
                enable_denoise=enable_denoise,
                enable_threshold=enable_threshold,
            )
            send_bytes = prep.output_bytes
            prep_info = {
                "applied": True,
                "perspective_corrected": prep.perspective_corrected,
                "rotation_applied": prep.rotation_applied,
                "sharpness": prep.sharpness_score,
                "original_dim": (prep.original_w, prep.original_h),
                "output_dim": (prep.output_w, prep.output_h),
                "detected_corners": prep.detected_corners,
                "notes": prep.notes,
                "preprocessed_bytes": prep.output_bytes,
                "enhancements": {
                    "clahe": enable_clahe,
                    "denoise": enable_denoise,
                    "threshold": enable_threshold,
                },
            }
        except Exception as e:  # noqa: BLE001
            send_bytes = file_bytes
            prep_info = {"applied": True, "failed": str(e)}
    else:
        send_bytes = file_bytes

    tmp = Path("/tmp") / f"streamlit_bon_{bytes_hash}_{file_name}"
    tmp.write_bytes(send_bytes)

    def _check_reconciliation(receipt_dict: Optional[dict]) -> tuple[bool, float]:
        """Returns (passes_gate, delta_eur). Gate: |Σ items - Total| ≤ 0.05€."""
        if not receipt_dict:
            return (False, float("inf"))
        sum_items = sum((it["priceCents"] or 0) for it in receipt_dict.get("items", []))
        total = receipt_dict.get("totalCents") or 0
        if not total:
            return (False, float("inf"))
        delta = abs(total - sum_items) / 100.0
        return (delta <= 0.05, delta)

    try:
        # ----- Primary engine extraction -----
        if engine == "gemini":
            r = extract_one(get_gemini_client(), model, tmp)
            primary_cost = estimate_cents(r.model, r.inputTokens, r.outputTokens)
            primary_result = {
                "engine": "gemini",
                "ok": r.ok,
                "error": r.error,
                "latencyMs": r.latencyMs,
                "model": r.model,
                "promptVersion": r.promptVersion,
                "receipt": r.receipt.model_dump() if r.receipt else None,
                "rawText": r.rawText if not r.ok else None,
                "estCostCents": primary_cost,
                "inputTokens": r.inputTokens,
                "outputTokens": r.outputTokens,
                "pages": None,
                "docConfidence": None,
                "bytesHash": bytes_hash,
                "boundingBoxes": [],
                "prep": prep_info,
            }
        elif engine == "cv-hybrid":
            r = extract_cv_hybrid(tmp, gemini_model="gemini-2.5-flash")
            primary_cost = estimate_cv_hybrid_cents(r.pages or 1, r.inputTokens, r.outputTokens)
            primary_result = {
                "engine": "cv-hybrid",
                "ok": r.ok,
                "error": r.error,
                "latencyMs": r.latencyMs,
                "model": r.engine,
                "promptVersion": r.promptVersion,
                "receipt": r.receipt.model_dump() if r.receipt else None,
                "rawText": r.rawText if not r.ok else None,
                "estCostCents": primary_cost,
                "inputTokens": r.inputTokens,
                "outputTokens": r.outputTokens,
                "pages": r.pages,
                "docConfidence": None,
                "bytesHash": bytes_hash,
                "boundingBoxes": [
                    {"label": b.label, "text": b.text, "confidence": b.confidence,
                     "x": b.x, "y": b.y, "w": b.w, "h": b.h}
                    for b in r.boundingBoxes
                ],
                "prep": prep_info,
                "cvLatencyMs": r.cv_latency_ms,
                "geminiLatencyMs": r.gemini_latency_ms,
            }
        else:  # docai
            r = extract_docai(tmp)
            primary_cost = estimate_docai_cents(r.pages or 1, "expense")
            primary_result = {
                "engine": "docai",
                "ok": r.ok,
                "error": r.error,
                "latencyMs": r.latencyMs,
                "model": r.engine,
                "promptVersion": r.promptVersion,
                "receipt": r.receipt.model_dump() if r.receipt else None,
                "rawText": r.rawText if not r.ok else None,
                "estCostCents": primary_cost,
                "inputTokens": None,
                "outputTokens": None,
                "pages": r.pages,
                "docConfidence": r.docConfidence,
                "bytesHash": bytes_hash,
                "boundingBoxes": [
                    {"label": b.label, "text": b.text, "confidence": b.confidence,
                     "x": b.x, "y": b.y, "w": b.w, "h": b.h}
                    for b in r.boundingBoxes
                ],
                "prep": prep_info,
            }

        # ----- Auto-escalation: if primary failed reconciliation, retry with DocAI -----
        primary_passes, primary_delta = _check_reconciliation(primary_result["receipt"])
        if escalate and primary_result["ok"] and not primary_passes and engine != "docai":
            # Run DocAI as backup
            docai_r = extract_docai(tmp)
            docai_passes, docai_delta = _check_reconciliation(
                docai_r.receipt.model_dump() if docai_r.receipt else None
            )
            docai_cost = estimate_docai_cents(docai_r.pages or 1, "expense")
            primary_result["escalation"] = {
                "fired": True,
                "primary_delta_eur": primary_delta if primary_delta != float("inf") else None,
                "docai_passes": docai_passes,
                "docai_delta_eur": docai_delta if docai_delta != float("inf") else None,
                "docai_cost_cents": docai_cost,
                "docai_latency_ms": docai_r.latencyMs,
            }
            # If DocAI did better, swap in its result for display
            if docai_passes and docai_r.receipt:
                primary_result["receipt"] = docai_r.receipt.model_dump()
                primary_result["estCostCents"] = (primary_cost or 0) + (docai_cost or 0)
                primary_result["model"] = f"{primary_result['model']} → escalated to docai/expense"
                # Replace bounding boxes too — DocAI's are correct for the escalated result
                primary_result["boundingBoxes"] = [
                    {"label": b.label, "text": b.text, "confidence": b.confidence,
                     "x": b.x, "y": b.y, "w": b.w, "h": b.h}
                    for b in docai_r.boundingBoxes
                ]
            else:
                # DocAI didn't help either — keep primary but log
                primary_result["estCostCents"] = (primary_cost or 0) + (docai_cost or 0)
                primary_result["model"] = f"{primary_result['model']} (escalation tried, DocAI also Δ={docai_delta:.2f})"
        else:
            primary_result["escalation"] = {"fired": False}

        return primary_result
    finally:
        try:
            tmp.unlink()
        except OSError:
            pass


# ---------------------------------------------------------------------------
# Empty state
# ---------------------------------------------------------------------------

if not uploaded:
    st.info(
        "👆 Drag-drop deine Kassenbon-Fotos. Sie werden direkt an die gewählte "
        "Engine geschickt, das Result erscheint Side-by-Side mit dem Original."
    )
    st.markdown("---")
    st.markdown("### Was du brauchst für eine valide Stichprobe")
    st.markdown(
        """
        - 1× Aldi (Süd oder Nord) — High-volume Discounter
        - 1× Lidl
        - 1× Edeka
        - 1× Rewe
        - 1× Kaufland
        - 1× Penny / Netto
        - 1× zerknittert / verknickt — Real-world Capture-Qualität
        - 1× schräg fotografiert
        - 1× sehr lang (≥30 Items)
        - 1× kurz (3–4 Items) — Edge-Case Tier-Cutoff
        """
    )
    st.markdown("---")
    st.markdown("### Determinismus-Test")
    st.markdown(
        "Lade **denselben Bon zweimal** hoch (gleiche Datei oder eine Kopie mit "
        "anderem Namen). Bei einer **deterministischen** Engine müssen beide "
        "Ergebnisse identisch sein. Das **Determinismus-Gate** unten zeigt dir das."
    )
    st.stop()


# ---------------------------------------------------------------------------
# Process all bons
# ---------------------------------------------------------------------------

_docai_configured = bool(
    os.environ.get("DOCUMENTAI_PROCESSOR_ID")
    and os.environ.get("GOOGLE_CLOUD_PROJECT")
)
if engine == "docai" and not _docai_configured:
    st.error(
        "Document AI ist gewählt, aber `DOCUMENTAI_PROCESSOR_ID` und/oder "
        "`GOOGLE_CLOUD_PROJECT` fehlen in der `.env`. "
        "Setup-Anleitung: README §Document AI."
    )
    st.stop()
if escalate and not _docai_configured:
    st.warning(
        "🚨 Auto-Escalate aktiviert, aber DocAI nicht konfiguriert. "
        "Escalation wird übersprungen — siehe README §Document AI."
    )

enh_parts = []
if enable_clahe:
    enh_parts.append("CLAHE")
if enable_denoise:
    enh_parts.append("Denoise")
if enable_threshold:
    enh_parts.append("Threshold")
prep_label = ("preprocessed" if preprocess_enabled else "raw") + (
    f" + {'+'.join(enh_parts)}" if enh_parts else ""
)

# Read all bytes upfront — file objects can't be read from worker threads
# safely (Streamlit's UploadedFile wraps a BytesIO that isn't thread-safe).
file_data: list[tuple[int, str, bytes]] = [
    (i, f.name, f.read()) for i, f in enumerate(uploaded)
]

# Parallel processing: each bon makes 1-3 sequential API calls (CV → Gemini,
# optionally → DocAI on escalate). API calls are I/O-bound, so threads are
# the right primitive here. With max_workers=8 and 6 bons, all run
# concurrently → wall-clock ≈ slowest single bon, not Σ(all bons).
n_bons = len(file_data)
n_workers = min(_MAX_PARALLEL_WORKERS, max(1, n_bons))
parallel_label = f"parallel x{n_workers}" if n_workers > 1 else "sequential"
progress = st.progress(
    0.0,
    text=f"Processing {n_bons} bons via {model} ({prep_label}, {parallel_label}, max_dim={max_dim}px) …",
)

# Pre-allocate slot list so results land in upload order regardless of
# completion order. Streamlit progress can't be updated from worker
# threads — we only update from as_completed() in the main thread.
results: list[Optional[tuple[str, bytes, dict]]] = [None] * n_bons
batch_started = time.monotonic()


def _run_one(idx: int, name: str, raw: bytes) -> tuple[int, str, bytes, dict, float]:
    started = time.monotonic()
    res = process(
        raw, name, engine, model, preprocess_enabled,
        enable_clahe=enable_clahe,
        enable_denoise=enable_denoise,
        enable_threshold=enable_threshold,
        escalate=escalate,
        max_dim=max_dim,
    )
    elapsed = time.monotonic() - started
    return idx, name, raw, res, elapsed


with ThreadPoolExecutor(max_workers=n_workers) as executor:
    futures = [executor.submit(_run_one, i, n, b) for i, n, b in file_data]
    completed = 0
    for fut in as_completed(futures):
        idx, name, raw, res, elapsed = fut.result()
        results[idx] = (name, raw, res)
        completed += 1
        progress.progress(
            completed / n_bons,
            text=f"[{completed}/{n_bons}] ✓ {name} ({elapsed * 1000:.0f} ms)",
        )

progress.empty()
batch_wall_ms = int((time.monotonic() - batch_started) * 1000)
# Drop sentinel placeholders just in case (shouldn't happen, but defensive)
results = [r for r in results if r is not None]  # type: ignore[assignment]


# ---------------------------------------------------------------------------
# Aggregate stats
# ---------------------------------------------------------------------------

ok_results = [(n, b, r) for n, b, r in results if r["ok"]]
fail_results = [(n, b, r) for n, b, r in results if not r["ok"]]
ok_pct = (len(ok_results) * 100 // max(1, len(results)))

# Δ analysis
deltas: list[float] = []
for _, _, r in ok_results:
    rcpt = r["receipt"]
    if not rcpt:
        continue
    sum_items = sum((it["priceCents"] or 0) for it in rcpt.get("items", []))
    total = rcpt.get("totalCents") or 0
    if total:
        deltas.append(abs(total - sum_items) / 100.0)
within_5c = sum(1 for d in deltas if d <= 0.05)
within_5c_pct = (within_5c * 100 // max(1, len(deltas))) if deltas else 0

# Cost
cost_cents_total = sum(
    (r["estCostCents"] or 0) for _, _, r in ok_results
    if isinstance(r.get("estCostCents"), (int, float))
)
avg_cost_per_bon = cost_cents_total / max(1, len(ok_results))
month_estimate_usd = (avg_cost_per_bon * 1500 * 30) / 100  # ¢→$, 1.5k/day, 30 days

# Latency
avg_latency = sum(r["latencyMs"] for _, _, r in ok_results) / max(1, len(ok_results))

# Determinism — group results by bytesHash, check if all in a group have identical receipt JSON
det_groups: dict[str, list[dict]] = {}
for _, _, r in results:
    h = r.get("bytesHash") or "?"
    det_groups.setdefault(h, []).append(r)

det_dup_groups = {h: g for h, g in det_groups.items() if len(g) > 1}
det_consistent = 0
det_inconsistent = 0
for h, g in det_dup_groups.items():
    rcpts = [json.dumps(x["receipt"], sort_keys=True, ensure_ascii=False)
             for x in g if x["ok"]]
    if not rcpts:
        continue
    if all(rc == rcpts[0] for rc in rcpts):
        det_consistent += 1
    else:
        det_inconsistent += 1
det_total_dups = det_consistent + det_inconsistent
det_pct: Optional[int] = (
    (det_consistent * 100 // det_total_dups) if det_total_dups else None
)


# Decision-gate verdicts
def gate(value: float, threshold: float, kind: str = "min") -> str:
    if kind == "min":
        if value >= threshold:
            return "ok"
        if value >= threshold * 0.9:
            return "warn"
        return "fail"
    else:  # max
        if value <= threshold:
            return "ok"
        if value <= threshold * 1.5:
            return "warn"
        return "fail"


gate_ok = gate(ok_pct, 95, "min")
gate_delta = gate(within_5c_pct, 95, "min")
# Cost gate is engine-specific
cost_gate_threshold = 0.3 if engine == "gemini" else 12.0  # docai ≈ 10¢/page
gate_cost = gate(avg_cost_per_bon, cost_gate_threshold, "max")
gate_det = "ok" if (det_pct is None or det_pct == 100) else "fail"


def gate_badge(g: str, label: str) -> str:
    color = {"ok": "#1a7f37", "warn": "#9a6700", "fail": "#cf222e"}[g]
    icon = {"ok": "✓", "warn": "!", "fail": "✗"}[g]
    return f'<span style="color:{color};font-weight:700">{icon} {label}</span>'


# ---------------------------------------------------------------------------
# 4-card decision gate
# ---------------------------------------------------------------------------

st.markdown("## 📊 Decision Gate")
gate_cols = st.columns(4)

with gate_cols[0]:
    st.markdown(
        f"""
        <div class='stat-card'>
          <div class='stat-num'>{ok_pct} %</div>
          <div class='stat-label'>OK Quote · Gate ≥95 %</div>
          <div style='margin-top:6px'>{gate_badge(gate_ok, "Gate")}</div>
        </div>
        """,
        unsafe_allow_html=True,
    )
with gate_cols[1]:
    st.markdown(
        f"""
        <div class='stat-card'>
          <div class='stat-num'>{within_5c_pct} %</div>
          <div class='stat-label'>Bons Δ ≤ 0,05 € · Gate ≥95 %</div>
          <div style='margin-top:6px'>{gate_badge(gate_delta, "Gate")}</div>
        </div>
        """,
        unsafe_allow_html=True,
    )
with gate_cols[2]:
    st.markdown(
        f"""
        <div class='stat-card'>
          <div class='stat-num'>{avg_cost_per_bon:.4f} ¢</div>
          <div class='stat-label'>Avg cost / Bon · Gate ≤{cost_gate_threshold:.1f} ¢</div>
          <div style='margin-top:6px'>{gate_badge(gate_cost, "Gate")}</div>
        </div>
        """,
        unsafe_allow_html=True,
    )
with gate_cols[3]:
    if det_total_dups == 0:
        det_display = "—"
        det_label = "Determinismus · Lade Bon 2× hoch"
    else:
        det_display = f"{det_pct} %"
        det_label = f"Determinismus · {det_consistent}/{det_total_dups} match"
    st.markdown(
        f"""
        <div class='stat-card'>
          <div class='stat-num'>{det_display}</div>
          <div class='stat-label'>{det_label}</div>
          <div style='margin-top:6px'>{gate_badge(gate_det, "Gate")}</div>
        </div>
        """,
        unsafe_allow_html=True,
    )

# Summary
all_green = (
    gate_ok == "ok" and gate_delta == "ok" and gate_cost == "ok"
    and (det_total_dups == 0 or gate_det == "ok")
)
if all_green:
    st.success(
        f"**Alle Gates grün** mit `{model}`. "
        f"Bei 1.5 k Bons/Tag = ~${month_estimate_usd:.2f} / Monat."
    )
elif gate_ok == "fail" or gate_delta == "fail" or gate_det == "fail":
    msg = []
    if gate_ok == "fail":
        msg.append("OK-Quote unter 95%")
    if gate_delta == "fail":
        msg.append("Δ-Quote unter 95% → Items/Discounts werden falsch erkannt")
    if gate_det == "fail":
        msg.append("Determinismus gebrochen → gleicher Bon → unterschiedliche JSONs")
    st.error("Hartes Problem: " + "; ".join(msg))
else:
    st.warning("Borderline. Schau dir die Per-Bon-Cards unten an.")

# Escalation summary (aggregate across all bons)
escalations_fired = [r for _, _, r in results if r.get("escalation", {}).get("fired")]
escalations_helped = [r for r in escalations_fired if r["escalation"].get("docai_passes")]
if escalations_fired:
    st.info(
        f"🚨 **Auto-Escalation:** fired on {len(escalations_fired)}/{len(results)} bons "
        f"({len(escalations_fired)*100//max(1,len(results))}%). "
        f"DocAI fixed {len(escalations_helped)} of them. "
        f"Extra cost-aufschlag: ~"
        f"{sum(r['escalation'].get('docai_cost_cents', 0) or 0 for r in escalations_fired):.4f} ¢ total."
    )

# Run details
st.markdown("### Run-Details")
sec_cols = st.columns(4)
with sec_cols[0]:
    st.markdown(
        f"<div class='stat-card'><div class='stat-num'>{len(results)}</div>"
        f"<div class='stat-label'>Bons gesamt</div></div>",
        unsafe_allow_html=True,
    )
with sec_cols[1]:
    st.markdown(
        f"<div class='stat-card'><div class='stat-num'>{len(fail_results)}</div>"
        f"<div class='stat-label'>FAILs</div></div>",
        unsafe_allow_html=True,
    )
with sec_cols[2]:
    sum_latency = sum(r["latencyMs"] for _, _, r in ok_results)
    speedup = sum_latency / batch_wall_ms if batch_wall_ms > 0 else 1.0
    st.markdown(
        f"<div class='stat-card'><div class='stat-num'>{avg_latency:.0f} ms</div>"
        f"<div class='stat-label'>Avg latency · Wall {batch_wall_ms} ms ({speedup:.1f}x parallel)</div></div>",
        unsafe_allow_html=True,
    )
with sec_cols[3]:
    st.markdown(
        f"<div class='stat-card'><div class='stat-num'>${month_estimate_usd:.2f}</div>"
        f"<div class='stat-label'>Hochrechnung @ 1.5k Bons/Tag</div></div>",
        unsafe_allow_html=True,
    )

# Determinism subdetail
if det_dup_groups:
    with st.expander(f"🔬 Determinismus-Detail ({len(det_dup_groups)} Bytes-Gruppe(n) mit Duplikaten)"):
        for h, group in det_dup_groups.items():
            names = [g_["bytesHash"] for g_ in group]
            file_names = []
            # Find filenames from the original results list
            for nm, _, r in results:
                if r.get("bytesHash") == h:
                    file_names.append(nm)
            rcpt_jsons = [json.dumps(g_["receipt"], sort_keys=True, ensure_ascii=False)
                          for g_ in group if g_["ok"]]
            same = all(j == rcpt_jsons[0] for j in rcpt_jsons) if rcpt_jsons else False
            status = "✅ identisch" if same else "❌ DIVERGIERT"
            st.markdown(f"**Bytes-Hash `{h}…`** ({len(group)} Uploads) → {status}")
            st.caption(f"Files: {', '.join(file_names)}")
            if not same and len(rcpt_jsons) >= 2:
                st.caption("Diff zwischen Output #1 und #2:")
                # crude diff
                col1, col2 = st.columns(2)
                with col1:
                    st.code(rcpt_jsons[0][:1500], language="json")
                with col2:
                    st.code(rcpt_jsons[1][:1500], language="json")

st.markdown("---")


# ---------------------------------------------------------------------------
# Per-bon detail cards
# ---------------------------------------------------------------------------

st.markdown(f"## 🧾 Per-Bon Details ({len(results)})")


BBOX_COLORS = {
    "merchant": (255, 100, 100, 200),  # red
    "date":     (100, 200, 255, 200),  # blue
    "total":    (50, 200, 80, 220),    # green
    "subtotal": (180, 180, 100, 200),  # olive
    "item":     (255, 180, 60, 200),   # orange
    "discount": (200, 100, 255, 200),  # purple
}


def _detect_text_orientation(bboxes: list[dict]) -> int:
    """Detect required display rotation by scoring all 4 possible rotations.

    A correctly-oriented receipt layout has:
      - Merchant box near the TOP of the image (small y)
      - Total box near the BOTTOM (large y)
      - Items between them, with text reading horizontally (w > h)
      - Items column has consistent x position (small horizontal spread)

    For each candidate rotation (0/90/180/270), apply the rotation to the
    boxes, compute a layout score, return the rotation with the best score.

    This is more robust than my earlier "merchant on left → 90°" heuristic
    because it uses the FULL receipt layout (merchant + total + items),
    not just one anchor.

    Returns degrees: 0, 90, 180, or 270 (CW positive).
    """
    if not bboxes:
        return 0

    item_boxes = [b for b in bboxes if b["label"] == "item" and b["h"] > 0.001 and b["w"] > 0.001]
    if len(item_boxes) < 2:
        return 0  # not enough layout signal

    def score(rot: int) -> float:
        rotated = [_rotate_bbox(b, rot) for b in bboxes]
        merchants = [b for b in rotated if b["label"] == "merchant"]
        items = [b for b in rotated if b["label"] == "item"]
        totals = [b for b in rotated if b["label"] == "total"]
        dates = [b for b in rotated if b["label"] == "date"]

        s = 0.0

        # Merchant near top: bonus for small y
        if merchants:
            avg_y = sum(b["y"] + b["h"] / 2 for b in merchants) / len(merchants)
            s += (1.0 - avg_y) * 30

        # Total near bottom: bonus for large y
        if totals:
            avg_y = sum(b["y"] + b["h"] / 2 for b in totals) / len(totals)
            s += avg_y * 30

        # Date near top: bonus for small y (smaller weight than merchant)
        if dates:
            avg_y = sum(b["y"] + b["h"] / 2 for b in dates) / len(dates)
            s += (1.0 - avg_y) * 10

        # Items: text reads horizontally → boxes wider than tall
        wider = sum(1 for b in items if b["w"] > b["h"])
        s += (wider / max(1, len(items))) * 30

        # Items column consistency: x-coordinate variance (low variance = good)
        if items:
            xs = [b["x"] for b in items]
            mean_x = sum(xs) / len(xs)
            var_x = sum((x - mean_x) ** 2 for x in xs) / len(xs)
            # Penalty: high variance means items aren't in a column → wrong orientation
            s -= var_x * 50

        return s

    # Score each candidate, pick best
    candidates = [0, 90, 180, 270]
    best = max(candidates, key=score)
    return best


def _rotate_bbox(b: dict, deg: int) -> dict:
    """Rotate a normalized bbox by `deg` (0/90/180/270, CW positive)."""
    x, y, w, h = b["x"], b["y"], b["w"], b["h"]
    if deg == 0:
        nx, ny, nw, nh = x, y, w, h
    elif deg == 90:
        # CW: (x, y, w, h) → (1 - y - h, x, h, w)
        nx, ny, nw, nh = 1.0 - y - h, x, h, w
    elif deg == 180:
        nx, ny, nw, nh = 1.0 - x - w, 1.0 - y - h, w, h
    elif deg == 270:
        # CCW: (x, y, w, h) → (y, 1 - x - w, h, w)
        nx, ny, nw, nh = y, 1.0 - x - w, h, w
    else:
        nx, ny, nw, nh = x, y, w, h
    return {**b, "x": nx, "y": ny, "w": nw, "h": nh}


def _draw_overlay(pil_img: Image.Image, bboxes: list[dict]) -> Image.Image:
    """Overlay colored bounding boxes + labels on the receipt image."""
    if not bboxes:
        return pil_img

    img = pil_img.convert("RGBA")
    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    w, h = img.size

    # Try to load a small font; fall back to default
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 14)
        font_small = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 11)
    except OSError:
        font = ImageFont.load_default()
        font_small = font

    # Draw rectangles + labels
    for b in bboxes:
        color = BBOX_COLORS.get(b["label"], (255, 255, 255, 200))
        x = int(b["x"] * w)
        y = int(b["y"] * h)
        bw = int(b["w"] * w)
        bh = int(b["h"] * h)

        # Outline
        draw.rectangle([x, y, x + bw, y + bh], outline=color, width=3)

        # Label tag at top-left of box
        label = b["label"].upper()
        tag_w = draw.textlength(label, font=font_small) + 8
        tag_h = 16
        tag_y = max(0, y - tag_h)
        draw.rectangle([x, tag_y, x + tag_w, tag_y + tag_h], fill=color)
        draw.text((x + 4, tag_y + 1), label, fill=(255, 255, 255), font=font_small)

    return Image.alpha_composite(img, overlay).convert("RGB")


def render_image(file_bytes: bytes, file_name: str, prep: dict, bboxes: list[dict], show_overlay_flag: bool, manual_rot: int = 0) -> None:
    if file_name.lower().endswith(".pdf"):
        st.warning("PDF preview not rendered — sent to engine directly.")
        return
    try:
        # Show the *preprocessed* image if available (so overlay coordinates match what OCR saw)
        if prep.get("applied") and prep.get("preprocessed_bytes"):
            img = Image.open(BytesIO(prep["preprocessed_bytes"]))
            cap = "preprocessed"
        else:
            img = Image.open(BytesIO(file_bytes))
            cap = "original"

        # Auto-detect display orientation from box layout, plus manual override
        auto_rot = _detect_text_orientation(bboxes)
        total_rot = (auto_rot + manual_rot) % 360
        if total_rot:
            # PIL rotate is CCW-positive; we want CW-positive convention
            img = img.rotate(-total_rot, expand=True)
            bboxes_for_display = [_rotate_bbox(b, total_rot) for b in bboxes]
            cap += f" · rotated {total_rot}° for display"
        else:
            bboxes_for_display = bboxes

        if show_overlay_flag and bboxes_for_display:
            img = _draw_overlay(img, bboxes_for_display)
            cap += f" + overlay ({len(bboxes_for_display)} boxes)"

        st.image(img, use_container_width=True, caption=cap)

        # Tiny legend if we have boxes
        if show_overlay_flag and bboxes:
            legend_html = " ".join(
                f'<span style="background:rgba({c[0]},{c[1]},{c[2]},0.6);color:white;'
                f'padding:1px 8px;border-radius:4px;font-size:10px;'
                f'font-weight:700;margin-right:4px">{lbl.upper()}</span>'
                for lbl, c in BBOX_COLORS.items()
                if any(b["label"] == lbl for b in bboxes)
            )
            st.markdown(legend_html, unsafe_allow_html=True)

        # Preprocessing info collapsible
        if prep.get("applied") and not prep.get("failed"):
            with st.expander("🖼 Preprocessing-Details"):
                if prep.get("rotation_applied"):
                    st.caption(f"EXIF-Rotation: {prep['rotation_applied']}°")
                if prep.get("perspective_corrected"):
                    st.caption("✓ Perspektive korrigiert + auf Bon-Rand gecropped")
                else:
                    st.caption("⚠ Keine 4 Ecken gefunden — Original verwendet")
                st.caption(f"Original: {prep['original_dim'][0]}×{prep['original_dim'][1]}px")
                st.caption(f"Output:   {prep['output_dim'][0]}×{prep['output_dim'][1]}px")
                if prep.get("sharpness") is not None:
                    sharp = prep["sharpness"]
                    sharp_emoji = "🟢" if sharp > 200 else "🟡" if sharp > 80 else "🔴"
                    st.caption(f"Schärfe: {sharp_emoji} {sharp:.0f} (>200 = scharf, <80 = blurry)")
                for note in prep.get("notes", []):
                    st.caption(f"  · {note}")
        elif prep.get("failed"):
            st.caption(f"⚠ Preprocessing failed: {prep['failed']}")
    except Exception as e:  # noqa: BLE001
        st.warning(f"Could not render preview for {file_name}: {e}")


for idx, (name, raw, r) in enumerate(results):
    with st.expander(
        label=f"{'✓' if r['ok'] else '✗'}  {name}  ·  {r.get('engine', '?')}",
        expanded=(idx == 0),
    ):
        cols = st.columns([1, 1.2])

        with cols[0]:
            # Per-bon manual rotation override (applied on top of auto-detect)
            rot_key = f"manual_rot_{name}_{r.get('bytesHash', '?')}"
            if rot_key not in st.session_state:
                st.session_state[rot_key] = 0
            render_image(
                raw,
                name,
                r.get("prep", {}),
                r.get("boundingBoxes", []),
                show_overlay,
                manual_rot=st.session_state[rot_key],
            )
            rot_cols = st.columns(4)
            for i, deg in enumerate([0, 90, 180, 270]):
                with rot_cols[i]:
                    label = f"{deg}°" if deg else "Auto"
                    if st.button(label, key=f"{rot_key}_btn_{deg}", use_container_width=True):
                        st.session_state[rot_key] = deg
                        st.rerun()

        with cols[1]:
            if not r["ok"]:
                st.error(f"**FAIL:** `{r['error']}`")
                if r.get("rawText"):
                    st.caption("Raw model output:")
                    st.code(r["rawText"][:2000], language="json")
                continue

            rcpt = r["receipt"]
            if not rcpt:
                st.warning("OK but no receipt body returned.")
                continue

            merchant = rcpt.get("merchant") or "—"
            sub = rcpt.get("merchantSubtitle") or ""
            date_ = rcpt.get("bonDate") or "—"
            time_ = rcpt.get("bonTime") or ""

            st.markdown(f"### {merchant}")
            if sub:
                st.caption(sub)

            pills = []
            pills.append(f'<span class="meta-pill">📅 {date_}</span>')
            if time_:
                pills.append(f'<span class="meta-pill">🕐 {time_}</span>')
            pills.append(f'<span class="meta-pill">{len(rcpt.get("items", []))} Items</span>')
            if rcpt.get("paymentMethod"):
                pills.append(f'<span class="meta-pill">💳 {rcpt["paymentMethod"]}</span>')
            if rcpt.get("suspiciousManipulation"):
                pills.append(
                    '<span class="meta-pill meta-pill-bad">⚠ Manipulation suspected</span>'
                )
            if not rcpt.get("isReceipt"):
                pills.append(
                    '<span class="meta-pill meta-pill-bad">✗ Not a receipt</span>'
                )
            st.markdown("".join(pills), unsafe_allow_html=True)

            # Numbers
            sum_items = sum((it["priceCents"] or 0) for it in rcpt.get("items", []))
            total = rcpt.get("totalCents") or 0
            delta = abs(total - sum_items) if total else None

            num_cols = st.columns(3)
            with num_cols[0]:
                st.metric("Total", f"{total/100:.2f} €")
            with num_cols[1]:
                st.metric("Σ Items", f"{sum_items/100:.2f} €")
            with num_cols[2]:
                if delta is not None:
                    delta_eur = delta / 100
                    color = (
                        "🟢" if delta_eur <= 0.05 else "🟡" if delta_eur <= 0.20 else "🔴"
                    )
                    st.metric("Δ", f"{color} {delta_eur:.2f} €")
                else:
                    st.metric("Δ", "—")

            # Eligibility preview
            eligible_count = len(rcpt.get("items", []))
            tier_cents = 8 if eligible_count >= 8 else 5 if eligible_count >= 4 else 0
            if tier_cents:
                st.caption(
                    f"📊 **Eligibility preview:** {eligible_count} Items · "
                    f"Tier wäre **{tier_cents} ¢** Cashback "
                    f"(noch ohne Catalogue-Match, das passiert in Phase 2)"
                )
            else:
                st.caption(
                    f"📊 **Eligibility preview:** {eligible_count} Items · "
                    f"unter 4-Items-Cutoff, **0 ¢**"
                )

            # Items table
            st.markdown("**Items**")
            items_html = ""
            for it in rcpt.get("items", []):
                qty = it.get("qty") or 1
                qty_str = f"{int(qty)}× " if qty != 1 else ""
                cat = it.get("category")
                cat_str = f' <span style="color:#8b949e">· {cat}</span>' if cat else ""
                items_html += (
                    f'<div class="item-row">'
                    f'<span class="item-name">{qty_str}{it["name"]}{cat_str}</span>'
                    f'<span class="item-price">{(it["priceCents"] or 0)/100:.2f} €</span>'
                    f"</div>"
                )
            st.markdown(items_html, unsafe_allow_html=True)

            # Engine-specific cost line
            cost = r.get("estCostCents")
            if r["engine"] == "gemini":
                st.caption(
                    f"⚙ {r['model']} · {r['latencyMs']} ms · "
                    f"{r.get('inputTokens', '?')} in + {r.get('outputTokens', '?')} out tok · "
                    f"~{cost or 0:.4f} ¢ · bytes-hash `{r.get('bytesHash', '?')}`"
                )
            elif r["engine"] == "cv-hybrid":
                st.caption(
                    f"⚙ {r['model']} · "
                    f"{r['latencyMs']} ms (CV {r.get('cvLatencyMs', '?')} + Gemini {r.get('geminiLatencyMs', '?')}) · "
                    f"{r.get('inputTokens', '?')} in + {r.get('outputTokens', '?')} out tok · "
                    f"~{cost or 0:.4f} ¢ · bytes-hash `{r.get('bytesHash', '?')}`"
                )
            else:
                st.caption(
                    f"⚙ {r['model']} · {r['latencyMs']} ms · "
                    f"{r.get('pages', 1)} page(s) · "
                    f"~{cost or 0:.4f} ¢ · bytes-hash `{r.get('bytesHash', '?')}`"
                )

            # Escalation badge if fired
            esc = r.get("escalation", {})
            if esc.get("fired"):
                if esc.get("docai_passes"):
                    st.success(
                        f"🚨 **Escalated to DocAI** — primary delta was "
                        f"{esc.get('primary_delta_eur', 0):.2f} €. DocAI fixed it "
                        f"(Δ={esc.get('docai_delta_eur', 0):.2f} €). "
                        f"Extra cost: ~{esc.get('docai_cost_cents', 0):.4f} ¢, "
                        f"+{esc.get('docai_latency_ms', 0)} ms latency."
                    )
                else:
                    st.warning(
                        f"🚨 **Escalation tried, didn't help** — primary Δ="
                        f"{esc.get('primary_delta_eur', 0):.2f} €, "
                        f"DocAI Δ={esc.get('docai_delta_eur', 0):.2f} €. "
                        f"Extra cost: ~{esc.get('docai_cost_cents', 0):.4f} ¢ wasted."
                    )

            # Confidence
            conf = rcpt.get("ocrConfidence")
            if conf is not None:
                st.progress(float(conf), text=f"Confidence: {conf:.2f}")

            if rcpt.get("manipulationNotes"):
                st.warning(f"**Manipulation notes:** {rcpt['manipulationNotes']}")

            with st.expander("Raw JSON"):
                st.code(json.dumps(rcpt, indent=2, ensure_ascii=False), language="json")


st.markdown("---")
st.caption(
    "Run-Cache: gleicher Bon + gleiche Engine + gleiches Modell = kein zweiter API-Call. "
    "Engine wechseln in der Sidebar → frischer Run gegen die neue Engine. "
    "Logs landen NICHT in Firestore — alles bleibt lokal in dieser Session."
)
