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
from image_prep import preprocess as preprocess_image

# Cache-busting key. Bump this whenever extraction logic, prompts,
# preprocessing, or merchant fallback changes — invalidates all cached
# extractions in one shot so users don't see stale results from old code.
_CACHE_VERSION = "v4-2026-05-03-orient"

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
    "gemini": "🤖 Gemini (LLM-based, schnell, non-deterministisch)",
    "docai":  "📄 Document AI Expense Parser (spezialisiert, deterministisch)",
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
        index=list(ENGINES.keys()).index("docai"),  # Default = DocAI (deterministisch)
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
    else:  # docai
        model = "docai/expense"
        proc_id = os.environ.get("DOCUMENTAI_PROCESSOR_ID", "")
        proc_loc = os.environ.get("DOCUMENTAI_LOCATION", "eu")
        proc_proj = os.environ.get("GOOGLE_CLOUD_PROJECT", "")
        if proc_id and proc_proj:
            st.caption(f"Processor: `{proc_id}` in `{proc_loc}`")
            st.caption(f"Project: `{proc_proj}`")
            st.caption("Pricing: $0,10 / page (Expense Parser)")
        else:
            st.error(
                "DocAI nicht konfiguriert. Setze in `.env`:\n\n"
                "`GOOGLE_CLOUD_PROJECT`, `DOCUMENTAI_LOCATION`, `DOCUMENTAI_PROCESSOR_ID`\n\n"
                "Siehe README §Document AI."
            )

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
    code_version: str = _CACHE_VERSION,
) -> dict:
    """Wrap engine extraction with bytes-cached invocation.

    Returns a uniform result dict regardless of engine.
    Cache key includes preprocess flag AND code_version — toggling either
    triggers fresh API calls.
    """
    bytes_hash = hashlib.sha256(file_bytes).hexdigest()[:16]
    _ = code_version  # only used for cache-key invalidation

    # Run image preprocessing if enabled
    prep_info: dict = {"applied": False}
    if preprocess_enabled:
        try:
            prep = preprocess_image(file_bytes)
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
            }
        except Exception as e:  # noqa: BLE001
            send_bytes = file_bytes
            prep_info = {"applied": True, "failed": str(e)}
    else:
        send_bytes = file_bytes

    tmp = Path("/tmp") / f"streamlit_bon_{bytes_hash}_{file_name}"
    tmp.write_bytes(send_bytes)

    try:
        if engine == "gemini":
            r = extract_one(get_gemini_client(), model, tmp)
            cost = estimate_cents(r.model, r.inputTokens, r.outputTokens)
            return {
                "engine": "gemini",
                "ok": r.ok,
                "error": r.error,
                "latencyMs": r.latencyMs,
                "model": r.model,
                "promptVersion": r.promptVersion,
                "receipt": r.receipt.model_dump() if r.receipt else None,
                "rawText": r.rawText if not r.ok else None,
                "estCostCents": cost,
                "inputTokens": r.inputTokens,
                "outputTokens": r.outputTokens,
                "pages": None,
                "docConfidence": None,
                "bytesHash": bytes_hash,
                "boundingBoxes": [],
                "prep": prep_info,
            }
        else:  # docai
            r = extract_docai(tmp)
            cost = estimate_docai_cents(r.pages or 1, "expense")
            return {
                "engine": "docai",
                "ok": r.ok,
                "error": r.error,
                "latencyMs": r.latencyMs,
                "model": r.engine,
                "promptVersion": r.promptVersion,
                "receipt": r.receipt.model_dump() if r.receipt else None,
                "rawText": r.rawText if not r.ok else None,
                "estCostCents": cost,
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

if engine == "docai" and not (
    os.environ.get("DOCUMENTAI_PROCESSOR_ID")
    and os.environ.get("GOOGLE_CLOUD_PROJECT")
):
    st.error(
        "Document AI ist gewählt, aber `DOCUMENTAI_PROCESSOR_ID` und/oder "
        "`GOOGLE_CLOUD_PROJECT` fehlen in der `.env`. "
        "Setup-Anleitung: README §Document AI."
    )
    st.stop()

results: list[tuple[str, bytes, dict]] = []
prep_label = "preprocessed" if preprocess_enabled else "raw"
progress = st.progress(0.0, text=f"Processing {len(uploaded)} bons via {model} ({prep_label}) …")
for idx, f in enumerate(uploaded):
    raw = f.read()
    started = time.monotonic()
    res = process(raw, f.name, engine, model, preprocess_enabled)
    elapsed = time.monotonic() - started
    results.append((f.name, raw, res))
    progress.progress(
        (idx + 1) / len(uploaded),
        text=f"[{idx + 1}/{len(uploaded)}] {f.name} ({elapsed * 1000:.0f} ms)",
    )
progress.empty()


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
    st.markdown(
        f"<div class='stat-card'><div class='stat-num'>{avg_latency:.0f} ms</div>"
        f"<div class='stat-label'>Avg latency</div></div>",
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
    """Detect required display rotation based on bounding box layout.

    Receipts read TOP-TO-BOTTOM, so item boxes should be wider than tall
    (text lines run horizontal). And the merchant box should be near the
    TOP of the image.

    Returns degrees of rotation needed for upright display: 0, 90, 180, or 270.
    Convention: positive = rotate CW.
    """
    if not bboxes:
        return 0

    # Gather valid item-like boxes
    item_boxes = [b for b in bboxes if b["label"] == "item" and b["h"] > 0.001 and b["w"] > 0.001]
    if len(item_boxes) < 3:
        return 0  # not enough data to judge

    # Median aspect ratio of item boxes (w/h)
    ratios = sorted(b["w"] / b["h"] for b in item_boxes)
    median_ar = ratios[len(ratios) // 2]

    # If items are tall+narrow (ar < 0.7), text is rotated 90° relative to image
    if median_ar >= 0.7:
        # Items already wider than tall → text reads horizontally → could
        # still be upside-down (180°). Check merchant position.
        merchant_box = next((b for b in bboxes if b["label"] == "merchant"), None)
        if merchant_box and merchant_box["y"] > 0.6:
            # Merchant is in bottom 40% → image is upside down
            return 180
        return 0  # upright

    # Items are tall+narrow → text rotated 90°. Determine CW vs CCW from merchant position.
    merchant_box = next((b for b in bboxes if b["label"] == "merchant"), None)
    if merchant_box:
        # If merchant is on the LEFT of the image, text reads bottom-to-top
        # → need to rotate 90° CW so merchant ends up at the top.
        # If merchant is on the RIGHT, text reads top-to-bottom → rotate 90° CCW.
        if merchant_box["x"] < 0.4:
            return 90  # CW
        else:
            return 270  # CCW
    # No merchant box detected — default CW (more common phone-landscape orientation)
    return 90


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
            else:
                st.caption(
                    f"⚙ {r['model']} · {r['latencyMs']} ms · "
                    f"{r.get('pages', 1)} page(s) · "
                    f"~{cost or 0:.4f} ¢ · bytes-hash `{r.get('bytesHash', '?')}`"
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
