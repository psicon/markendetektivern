"""
Phase-0 OCR Validation Dashboard.

Streamlit-based local web UI for testing the Gemini receipt-OCR pipeline.

Run:
    cd tools/cashback-ocr-validation
    source .venv/bin/activate
    streamlit run dashboard.py

Then open http://localhost:8501

This file shares prompts.py + schema.py + the extract_one() function
with validate.py — single source of truth for the OCR call. The
dashboard is purely UI: drag-drop, model picker, result render.

Total isolation: own venv (`tools/cashback-ocr-validation/.venv`),
own port (8501), own deps. Does NOT touch the React Native app, the
Firestore project, or anything in `app/` / `cloud-functions/`.
"""

from __future__ import annotations

import json
import time
from io import BytesIO
from pathlib import Path
from typing import Optional

import streamlit as st
from dotenv import load_dotenv
from google import genai
from PIL import Image

from prompts import VERSION as PROMPT_VERSION
from validate import PRICING, estimate_cents, extract_one

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

# Custom CSS — calmer typography, tighter cards
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
    </style>
    """,
    unsafe_allow_html=True,
)


# ---------------------------------------------------------------------------
# Sidebar — controls
# ---------------------------------------------------------------------------

with st.sidebar:
    st.markdown("### ⚙️ Settings")

    model = st.selectbox(
        "OCR Model",
        options=sorted(PRICING.keys()),
        index=sorted(PRICING.keys()).index("gemini-2.5-flash"),
        help="gemini-2.5-flash = Plan B (default). flash-lite = cost floor. pro = höchste Qualität.",
    )

    st.markdown("---")
    st.markdown("### 📊 Decision Gates")
    st.markdown(
        """
        - **OK-Quote** ≥ 95 %
        - **Δ ≤ 0,05 €** ≥ 95 %
        - **Cost / Bon** ≤ 0,2 ¢
        """
    )

    st.markdown("---")
    st.markdown("### 💰 Cost reference")
    st.caption(
        f"`{model}` pricing per 1M tokens:\n"
        f"- Input: ${PRICING[model]['in']}\n"
        f"- Output: ${PRICING[model]['out']}"
    )

    st.markdown("---")
    st.caption(f"Prompt version: `{PROMPT_VERSION}`")
    st.caption(
        "Local-only tool. Bons leave **only** to Gemini API. "
        "Nothing is written to Firestore, App, or any prod system."
    )


# ---------------------------------------------------------------------------
# Header
# ---------------------------------------------------------------------------

st.markdown("# 🧾 Cashback OCR — Phase 0 Validation")
st.markdown(
    "Drag receipts in, see what Gemini extracts. Decision-gate stats appear "
    "live underneath. **No app/Firestore impact.**"
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
def get_client() -> genai.Client:
    import os

    return genai.Client(api_key=os.environ["GEMINI_API_KEY"])


# ---------------------------------------------------------------------------
# Per-bon processing — cache by file content hash so re-renders don't re-bill
# ---------------------------------------------------------------------------


@st.cache_data(show_spinner=False, max_entries=200)
def process(file_bytes: bytes, file_name: str, model: str) -> dict:
    """Wrap extract_one() with bytes-cached invocation."""
    tmp = Path("/tmp") / f"streamlit_bon_{abs(hash(file_bytes))}_{file_name}"
    tmp.write_bytes(file_bytes)
    try:
        result = extract_one(get_client(), model, tmp)
    finally:
        try:
            tmp.unlink()
        except OSError:
            pass

    return {
        "ok": result.ok,
        "error": result.error,
        "latencyMs": result.latencyMs,
        "inputTokens": result.inputTokens,
        "outputTokens": result.outputTokens,
        "model": result.model,
        "promptVersion": result.promptVersion,
        "receipt": result.receipt.model_dump() if result.receipt else None,
        "rawText": result.rawText if not result.ok else None,
    }


# ---------------------------------------------------------------------------
# Main view
# ---------------------------------------------------------------------------

if not uploaded:
    st.info(
        "👆 Drag-drop your receipt photos above. They'll be sent to Gemini, "
        "and the parsed JSON appears side-by-side with the original."
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

        Wenn nicht alles da ist: zumindest 5 verschiedene Discounter, jeweils
        einer als Foto. Reicht für ein klares Decision-Gate-Signal.
        """
    )
    st.stop()

# Process all bons (cached so re-renders are instant)
results: list[tuple[str, bytes, dict]] = []
progress = st.progress(0.0, text=f"Processing {len(uploaded)} bons via {model} …")
for idx, f in enumerate(uploaded):
    raw = f.read()
    started = time.monotonic()
    res = process(raw, f.name, model)
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
cost_cents_total = 0.0
for _, _, r in ok_results:
    c = estimate_cents(r["model"], r["inputTokens"], r["outputTokens"])
    if c:
        cost_cents_total += c
avg_cost_per_bon = cost_cents_total / max(1, len(ok_results))
month_estimate_usd = (avg_cost_per_bon * 1500 * 30) / 100  # 1.5k/day, 30 days, ¢→$

# Latency
avg_latency = sum(r["latencyMs"] for _, _, r in ok_results) / max(1, len(ok_results))

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
gate_cost = gate(avg_cost_per_bon, 0.2, "max")


def gate_badge(g: str, label: str) -> str:
    color = {"ok": "#1a7f37", "warn": "#9a6700", "fail": "#cf222e"}[g]
    icon = {"ok": "✓", "warn": "!", "fail": "✗"}[g]
    return f'<span style="color:{color};font-weight:700">{icon} {label}</span>'


st.markdown("## 📊 Decision Gate")
gate_cols = st.columns(3)
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
          <div class='stat-label'>Avg cost / Bon · Gate ≤0,2 ¢</div>
          <div style='margin-top:6px'>{gate_badge(gate_cost, "Gate")}</div>
        </div>
        """,
        unsafe_allow_html=True,
    )

# Summary line
all_green = gate_ok == "ok" and gate_delta == "ok" and gate_cost == "ok"
if all_green:
    st.success(
        f"**Alle 3 Gates grün** mit `{model}`. "
        f"Plan B kann gelocked werden. Bei 1.5 k Bons/Tag = ~${month_estimate_usd:.2f} / Monat."
    )
elif gate_ok == "fail" or gate_delta == "fail":
    st.error(
        "Mindestens ein Gate ist hart rot. Vor Phase-1: entweder Prompt-"
        "Iteration (siehe Per-Bon-FAILs unten), Modell-Upgrade auf "
        "`gemini-2.5-pro`, oder Hybrid mit Document AI."
    )
else:
    st.warning(
        "Borderline. Schau dir die Bons an wo Δ groß war, evtl. Prompt-Tuning genug."
    )

# Secondary stats
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

st.markdown("---")


# ---------------------------------------------------------------------------
# Per-bon detail cards
# ---------------------------------------------------------------------------

st.markdown(f"## 🧾 Per-Bon Details ({len(results)})")


def render_image(file_bytes: bytes, file_name: str) -> None:
    if file_name.lower().endswith(".pdf"):
        st.warning("PDF preview not rendered — sent to Gemini directly.")
        return
    try:
        img = Image.open(BytesIO(file_bytes))
        st.image(img, use_container_width=True)
    except Exception:
        st.warning(f"Could not render preview for {file_name}")


for idx, (name, raw, r) in enumerate(results):
    with st.expander(
        label=f"{'✓' if r['ok'] else '✗'}  {name}",
        expanded=(idx == 0),  # first one open by default
    ):
        cols = st.columns([1, 1.2])

        # Left: image preview
        with cols[0]:
            render_image(raw, name)

        # Right: parsed result
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

            # Header
            merchant = rcpt.get("merchant") or "—"
            sub = rcpt.get("merchantSubtitle") or ""
            date_ = rcpt.get("bonDate") or "—"
            time_ = rcpt.get("bonTime") or ""

            st.markdown(f"### {merchant}")
            if sub:
                st.caption(sub)

            # Pills
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

            # Cost line
            cost = estimate_cents(r["model"], r["inputTokens"], r["outputTokens"])
            st.caption(
                f"⚙ {r['model']} · {r['latencyMs']} ms · "
                f"{r.get('inputTokens', '?')} in + {r.get('outputTokens', '?')} out tok · "
                f"~{cost or 0:.4f} ¢"
            )

            # Confidence
            conf = rcpt.get("ocrConfidence")
            if conf is not None:
                st.progress(float(conf), text=f"Self-reported confidence: {conf:.2f}")

            # Manipulation notes
            if rcpt.get("manipulationNotes"):
                st.warning(f"**Manipulation notes:** {rcpt['manipulationNotes']}")

            # Raw JSON expander
            with st.expander("Raw JSON"):
                st.code(json.dumps(rcpt, indent=2, ensure_ascii=False), language="json")


# ---------------------------------------------------------------------------
# Footer
# ---------------------------------------------------------------------------

st.markdown("---")
st.caption(
    "Run-Cache: gleicher Bon + gleiches Modell = kein zweiter API-Call. "
    "Modell wechseln in der Sidebar → frischer Run gegen das neue Modell. "
    "Logs landen NICHT in Firestore — alles bleibt lokal in dieser Session."
)
