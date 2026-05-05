"""
Cashback Production Monitor — live view into the deployed pipeline.

Reads from Firestore (`receipts/*`) directly, no API call to the Cloud
Function needed. Renders KPIs, distributions, latency stats, and a
per-bon detail browser with the bon image + reprocess button.

Run from the parent dashboard via the Streamlit sidebar nav, or
directly:

    cd tools/cashback-ocr-validation
    source .venv/bin/activate
    streamlit run pages/01_Production_Monitor.py

Requires Application Default Credentials (run once on this machine):
    gcloud auth application-default login

This page READS from production Firestore. It does NOT write to user
docs. The only write side-effect is the `Reprocess` button which
re-publishes a PubSub message to retrigger `processCashback` for a
given receipt — useful when debugging an OCR fix without forcing the
user to re-upload.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from io import BytesIO
from typing import Any, Optional
from zoneinfo import ZoneInfo

import altair as alt
import pandas as pd
import streamlit as st

# Firebase Admin + GCP clients
import firebase_admin
from firebase_admin import credentials, firestore as fb_firestore, storage as fb_storage
from google.cloud import firestore as gcf
from google.cloud import pubsub_v1
from PIL import Image

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

PROJECT_ID = "markendetektive-895f7"
STORAGE_BUCKET = "markendetektive-895f7.appspot.com"
PUBSUB_TOPIC = "cashback-ocr-jobs"
BERLIN = ZoneInfo("Europe/Berlin")

# Approximate per-bon costs in cents — match the Cloud Function pricing.
# Used for the cost-per-bon estimate. Exact tokens are not currently
# persisted on the receipt doc, so this is a back-of-the-envelope.
COST_CENTS = {
    "cv-hybrid": 0.20,       # Vision $0.0015/page + ~Gemini Flash text
    "docai": 5.0,            # DocAI Expense $0.05/page
    "gemini-direct": 0.10,   # Gemini Flash on image, rough
}
ESCALATION_DOCAI_COST_CENTS = 5.0  # added when escalation fired (regardless of swap)


# ---------------------------------------------------------------------------
# Page chrome
# ---------------------------------------------------------------------------

st.set_page_config(
    page_title="Cashback Production Monitor",
    page_icon="🔴",
    layout="wide",
)

st.markdown(
    """
    <style>
      .block-container { padding-top: 2rem; padding-bottom: 4rem; max-width: 1500px; }
      .stat-card {
        background: #f6f8fa; border-radius: 12px; padding: 14px 18px;
        border: 1px solid #e1e4e8;
      }
      .stat-num { font-size: 28px; font-weight: 800; color: #0d1117; line-height: 1; }
      .stat-label { font-size: 11px; font-weight: 600; color: #57606a;
        text-transform: uppercase; letter-spacing: 0.04em; margin-top: 4px; }
      .pill { display: inline-block; padding: 2px 10px; border-radius: 999px;
              font-size: 11px; font-weight: 700; margin-right: 4px; }
      .pill-ok      { background: #ddf4ff; color: #0969da; }
      .pill-approve { background: #d1f4d9; color: #1a7f37; }
      .pill-review  { background: #fff8c5; color: #9a6700; }
      .pill-reject  { background: #ffebe9; color: #cf222e; }
      .pill-pending { background: #f0f1f3; color: #57606a; }
      .pill-engine  { background: #ddf4ff; color: #0969da; }
      .pill-docai   { background: #f4ddff; color: #8250df; }
      .pill-direct  { background: #f0f1f3; color: #57606a; }
    </style>
    """,
    unsafe_allow_html=True,
)


# ---------------------------------------------------------------------------
# Firebase / GCP client init (cached across reruns)
# ---------------------------------------------------------------------------


@st.cache_resource
def init_firebase() -> Any:
    """Initialize Firebase Admin SDK once per session via ADC."""
    if not firebase_admin._apps:
        firebase_admin.initialize_app(
            options={"projectId": PROJECT_ID, "storageBucket": STORAGE_BUCKET}
        )
    return fb_firestore.client()


@st.cache_resource
def init_pubsub() -> tuple[pubsub_v1.PublisherClient, str]:
    publisher = pubsub_v1.PublisherClient()
    topic_path = publisher.topic_path(PROJECT_ID, PUBSUB_TOPIC)
    return publisher, topic_path


@st.cache_resource
def init_bucket() -> Any:
    return fb_storage.bucket(STORAGE_BUCKET)


try:
    db = init_firebase()
except Exception as e:  # noqa: BLE001
    st.error(
        "❌ Firebase Admin init failed.\n\n"
        "Wahrscheinlich fehlen Application Default Credentials. Lauf einmal:\n\n"
        "```\ngcloud auth application-default login\n```\n\n"
        f"Original error: `{e}`"
    )
    st.stop()


# ---------------------------------------------------------------------------
# Sidebar — filter controls
# ---------------------------------------------------------------------------

with st.sidebar:
    st.markdown("### 🔴 Production Monitor")
    st.caption(f"Project: `{PROJECT_ID}`")

    range_choice = st.selectbox(
        "Zeitraum",
        options=["Letzte 6h", "Letzte 24h", "Letzte 7 Tage", "Letzte 30 Tage", "Heute (Berlin)"],
        index=2,
    )
    status_filter = st.multiselect(
        "Status",
        options=[
            "approved", "review", "rejected", "ocr_pending",
            "matched", "superseded",
        ],
        default=["approved", "review", "rejected"],
    )
    engine_filter = st.multiselect(
        "Engine",
        options=["cv-hybrid", "docai", "gemini-direct", "legacy/null"],
        default=["cv-hybrid", "docai", "gemini-direct", "legacy/null"],
        help="'legacy/null' = Bons aus der Zeit VOR Phase 2.2 (heute deployed). "
             "Die haben kein engine-Feld auf dem Doc. Standardmäßig drin.",
    )

    st.markdown("---")
    refresh = st.button("🔄 Refresh now (clear cache)")
    if refresh:
        st.cache_data.clear()
        st.rerun()
    st.caption("Auto-cache: 30 s. Click Refresh to force.")


# Compute time bounds
now_utc = datetime.now(timezone.utc)
if range_choice == "Letzte 6h":
    since = now_utc - timedelta(hours=6)
elif range_choice == "Letzte 24h":
    since = now_utc - timedelta(hours=24)
elif range_choice == "Letzte 7 Tage":
    since = now_utc - timedelta(days=7)
elif range_choice == "Letzte 30 Tage":
    since = now_utc - timedelta(days=30)
else:  # heute Berlin
    today_berlin = datetime.now(BERLIN).replace(hour=0, minute=0, second=0, microsecond=0)
    since = today_berlin.astimezone(timezone.utc)


# ---------------------------------------------------------------------------
# Firestore query (cached for 30 s)
# ---------------------------------------------------------------------------


@st.cache_data(ttl=30, show_spinner="Lade Receipts aus Firestore …")
def fetch_receipts(since_iso: str, _v: int = 1) -> list[dict]:
    """Pull all receipts created since `since_iso`. Cap at 1000 for safety."""
    since_dt = datetime.fromisoformat(since_iso)
    q = (
        db.collection("receipts")
        .where("createdAt", ">=", since_dt)
        .order_by("createdAt", direction=gcf.Query.DESCENDING)
        .limit(1000)
    )
    out = []
    for snap in q.stream():
        d = snap.to_dict() or {}
        d["_id"] = snap.id
        out.append(d)
    return out


try:
    receipts_all = fetch_receipts(since.isoformat())
except Exception as e:  # noqa: BLE001
    st.error(
        "Firestore-Query fehlgeschlagen. Wahrscheinlich fehlt `roles/datastore.user` "
        f"auf deinem ADC-Account.\n\n```\n{e}\n```"
    )
    st.stop()


# Apply client-side filters
def passes_filter(r: dict) -> bool:
    if status_filter and r.get("status") not in status_filter:
        return False
    if engine_filter:
        engine = (r.get("ocr") or {}).get("engine") or "legacy/null"
        if engine not in engine_filter:
            return False
    return True


receipts = [r for r in receipts_all if passes_filter(r)]


# ---------------------------------------------------------------------------
# Header
# ---------------------------------------------------------------------------

st.markdown("# 🔴 Cashback Production Monitor")
st.caption(
    f"Letzte Refresh: {datetime.now(BERLIN).strftime('%Y-%m-%d %H:%M:%S')} (Berlin) · "
    f"{len(receipts)} Bons (von {len(receipts_all)} im Zeitraum, vor Filter)"
)


# ---------------------------------------------------------------------------
# KPI row
# ---------------------------------------------------------------------------


def percentile(values: list[float], p: float) -> float:
    if not values:
        return 0.0
    s = sorted(values)
    idx = max(0, min(len(s) - 1, int(len(s) * p / 100)))
    return s[idx]


total = len(receipts)
approved_n = sum(1 for r in receipts if r.get("status") == "approved")
review_n = sum(1 for r in receipts if r.get("status") == "review")
rejected_n = sum(1 for r in receipts if r.get("status") == "rejected")
pending_n = sum(1 for r in receipts if r.get("status") in ("ocr_pending", "matched"))


def pct(n: int, d: int) -> int:
    return (n * 100) // max(1, d)


# Cost estimation
def estimate_cost(r: dict) -> float:
    ocr = r.get("ocr") or {}
    engine = ocr.get("engine")
    base = COST_CENTS.get(engine, 0.0) if engine else COST_CENTS["gemini-direct"]
    if (ocr.get("escalation") or {}).get("fired"):
        base += ESCALATION_DOCAI_COST_CENTS
    return base


total_cost_cents = sum(estimate_cost(r) for r in receipts)
avg_cost = total_cost_cents / max(1, total)

# Forecast volume = "Annahme" für die Hochrechnung. 1.5k Bons/Tag ist die
# Architektur-Annahme aus CASHBACK_ARCHITECTURE.md §2.3.
FORECAST_BONS_PER_DAY = 1500
projected_daily_usd   = (avg_cost * FORECAST_BONS_PER_DAY) / 100
projected_monthly_usd = projected_daily_usd * 30
projected_yearly_usd  = projected_daily_usd * 365

# Reconciliation
recon_dirs: dict[str, int] = {}
for r in receipts:
    direction = ((r.get("ocr") or {}).get("reconciliation") or {}).get("direction") or "unknown"
    recon_dirs[direction] = recon_dirs.get(direction, 0) + 1

# Escalation
escalation_fired = sum(
    1 for r in receipts if ((r.get("ocr") or {}).get("escalation") or {}).get("fired")
)
escalation_swapped = sum(
    1 for r in receipts if ((r.get("ocr") or {}).get("escalation") or {}).get("swapped")
)

# Latency
lat_total = [
    (r.get("ocr") or {}).get("latencyMs", 0)
    for r in receipts
    if (r.get("ocr") or {}).get("latencyMs")
]
lat_cv = [
    (r.get("ocr") or {}).get("cvLatencyMs", 0)
    for r in receipts
    if (r.get("ocr") or {}).get("cvLatencyMs")
]
lat_gemini = [
    (r.get("ocr") or {}).get("geminiLatencyMs", 0)
    for r in receipts
    if (r.get("ocr") or {}).get("geminiLatencyMs")
]

# Engine distribution
engine_counts: dict[str, int] = {}
for r in receipts:
    engine = (r.get("ocr") or {}).get("engine") or "(alt)"
    engine_counts[engine] = engine_counts.get(engine, 0) + 1


# Health gates — show banners when something is off
gate_warnings = []
if total > 0:
    esc_rate = escalation_fired * 100 // total
    if esc_rate > 20:
        gate_warnings.append(
            f"⚠️ **Escalation rate {esc_rate}%** — OCR-Quali sinkt. "
            "Prüfe ob Capture-Side-Probleme da sind oder Gemini-Prompt nachjustiert werden muss."
        )
    if avg_cost > 0.5:
        gate_warnings.append(
            f"⚠️ **Avg cost {avg_cost:.2f} ¢/Bon** — über 0.5 ¢-Ziel. "
            "Zu hohe Escalation-Rate oder DocAI feuert oft."
        )
    rej_rate = rejected_n * 100 // total
    if rej_rate > 30:
        gate_warnings.append(
            f"⚠️ **Reject rate {rej_rate}%** — Capture/User-Onboarding-Problem?"
        )

for w in gate_warnings:
    st.warning(w)


# Status row
st.markdown("## 📊 Status")
c1, c2, c3, c4, c5 = st.columns(5)
c1.markdown(
    f"<div class='stat-card'><div class='stat-num'>{total}</div>"
    f"<div class='stat-label'>Bons gesamt</div></div>",
    unsafe_allow_html=True,
)
c2.markdown(
    f"<div class='stat-card'><div class='stat-num' style='color:#1a7f37'>{approved_n}</div>"
    f"<div class='stat-label'>Approved · {pct(approved_n, total)}%</div></div>",
    unsafe_allow_html=True,
)
c3.markdown(
    f"<div class='stat-card'><div class='stat-num' style='color:#9a6700'>{review_n}</div>"
    f"<div class='stat-label'>Review · {pct(review_n, total)}%</div></div>",
    unsafe_allow_html=True,
)
c4.markdown(
    f"<div class='stat-card'><div class='stat-num' style='color:#cf222e'>{rejected_n}</div>"
    f"<div class='stat-label'>Rejected · {pct(rejected_n, total)}%</div></div>",
    unsafe_allow_html=True,
)
c5.markdown(
    f"<div class='stat-card'><div class='stat-num' style='color:#57606a'>{pending_n}</div>"
    f"<div class='stat-label'>Pending</div></div>",
    unsafe_allow_html=True,
)


# Cost + Escalation row
st.markdown("## 💰 Cost & Escalation")
st.caption(
    f"Hochrechnungen unten basieren auf der Annahme **{FORECAST_BONS_PER_DAY:,} Bons/Tag** "
    f"(aus CASHBACK_ARCHITECTURE.md §2.3) und dem aktuellen avg Cost/Bon. "
    f"Tatsächliche Bon-Volumes siehst du im Trend-Chart weiter unten."
)
c1, c2, c3, c4, c5 = st.columns(5)
c1.markdown(
    f"<div class='stat-card'><div class='stat-num'>{avg_cost:.3f} ¢</div>"
    f"<div class='stat-label'>Avg / Bon (geschätzt)</div></div>",
    unsafe_allow_html=True,
)
c2.markdown(
    f"<div class='stat-card'><div class='stat-num'>${projected_daily_usd:.2f}</div>"
    f"<div class='stat-label'>Forecast / Tag (@ 1.5k Bons)</div></div>",
    unsafe_allow_html=True,
)
c3.markdown(
    f"<div class='stat-card'><div class='stat-num'>${projected_monthly_usd:.2f}</div>"
    f"<div class='stat-label'>Forecast / Monat (30 Tage)</div></div>",
    unsafe_allow_html=True,
)
c4.markdown(
    f"<div class='stat-card'><div class='stat-num'>${projected_yearly_usd:,.0f}</div>"
    f"<div class='stat-label'>Forecast / Jahr (365 Tage)</div></div>",
    unsafe_allow_html=True,
)
with c5:
    st.markdown(
        f"<div class='stat-card'><div class='stat-num'>{escalation_fired}/{total}</div>"
        f"<div class='stat-label'>Escalations · {pct(escalation_fired, total)}%</div>"
        f"<div style='margin-top:6px;font-size:11px;color:#57606a'>"
        f"DocAI won {escalation_swapped} of {max(1,escalation_fired)}</div></div>",
        unsafe_allow_html=True,
    )


# ─── Time-series + Forecast chart ─────────────────────────────────────
st.markdown("### 📈 Trend (actual + forecast)")

# Build daily aggregation: bons per Berlin-day + total cost per day
daily_records: list[dict] = []
for r in receipts:
    created = r.get("createdAt")
    if hasattr(created, "to_datetime"):
        d = created.to_datetime()
    elif isinstance(created, datetime):
        d = created
    else:
        continue
    day = d.astimezone(BERLIN).date()
    daily_records.append({"day": day, "cost_cents": estimate_cost(r)})

if daily_records:
    df_daily = pd.DataFrame(daily_records)
    daily = (
        df_daily.groupby("day")
        .agg(bons=("cost_cents", "count"), cost_eur=("cost_cents", lambda s: s.sum() / 100))
        .reset_index()
    )

    # Fill missing days in range with 0 so the chart isn't sparse
    all_days = pd.date_range(
        start=since.astimezone(BERLIN).date(),
        end=datetime.now(BERLIN).date(),
        freq="D",
    ).date
    daily = daily.set_index("day").reindex(all_days, fill_value=0).reset_index().rename(columns={"index": "day"})

    # Forecast: extend 14 days into the future using the last-7-day average
    last_n = 7
    recent = daily.tail(last_n) if len(daily) >= last_n else daily
    avg_bons_per_day = recent["bons"].mean() if len(recent) else 0
    avg_cost_per_day = recent["cost_eur"].mean() if len(recent) else 0

    forecast_days = pd.date_range(
        start=daily["day"].iloc[-1] + pd.Timedelta(days=1),
        periods=14,
        freq="D",
    ).date
    forecast_df = pd.DataFrame({
        "day": forecast_days,
        "bons": avg_bons_per_day,
        "cost_eur": avg_cost_per_day,
    })

    # Combine for charting with a 'series' label so altair can color by it
    actual = daily.assign(series="actual")
    forecast = forecast_df.assign(series="forecast")
    combined = pd.concat([actual, forecast], ignore_index=True)
    combined["day"] = pd.to_datetime(combined["day"])

    chart_col1, chart_col2 = st.columns(2)
    with chart_col1:
        st.markdown("**Bons / Tag** — solid = actual, dashed = forecast (avg of last 7 days)")
        line = (
            alt.Chart(combined)
            .mark_line(point=True)
            .encode(
                x=alt.X("day:T", title=None),
                y=alt.Y("bons:Q", title="Bons / Tag"),
                color=alt.Color("series:N", legend=alt.Legend(title=None),
                                scale=alt.Scale(domain=["actual", "forecast"], range=["#0d8575", "#9a6700"])),
                strokeDash=alt.StrokeDash("series:N", legend=None,
                                          scale=alt.Scale(domain=["actual", "forecast"], range=[[1, 0], [4, 4]])),
                tooltip=["day:T", "bons:Q", "series:N"],
            )
            .properties(height=240)
        )
        st.altair_chart(line, use_container_width=True)
    with chart_col2:
        st.markdown("**Cost € / Tag** — solid = actual, dashed = forecast")
        line2 = (
            alt.Chart(combined)
            .mark_line(point=True)
            .encode(
                x=alt.X("day:T", title=None),
                y=alt.Y("cost_eur:Q", title="EUR / Tag"),
                color=alt.Color("series:N", legend=alt.Legend(title=None),
                                scale=alt.Scale(domain=["actual", "forecast"], range=["#0969da", "#9a6700"])),
                strokeDash=alt.StrokeDash("series:N", legend=None,
                                          scale=alt.Scale(domain=["actual", "forecast"], range=[[1, 0], [4, 4]])),
                tooltip=["day:T", "cost_eur:Q", "series:N"],
            )
            .properties(height=240)
        )
        st.altair_chart(line2, use_container_width=True)
    st.caption(
        f"Forecast = Durchschnitt der letzten {min(last_n, len(daily))} Tage, "
        f"projiziert 14 Tage voraus. Aktualisiert sich mit jedem neuen Bon."
    )
else:
    st.caption("Keine zeitliche Daten zum Plotten.")


# Latency row
st.markdown("## ⏱ Latency (ms)")
c1, c2, c3, c4 = st.columns(4)
c1.metric("P50 total", f"{percentile(lat_total, 50):.0f}")
c2.metric("P95 total", f"{percentile(lat_total, 95):.0f}")
c3.metric("P95 CV (Vision)", f"{percentile(lat_cv, 95):.0f}" if lat_cv else "—")
c4.metric("P95 Gemini", f"{percentile(lat_gemini, 95):.0f}" if lat_gemini else "—")


# Distribution charts
st.markdown("## 📈 Distributions")
c1, c2 = st.columns(2)
with c1:
    st.markdown("**Engine** (welche OCR-Engine den Bon verarbeitet hat)")
    if engine_counts:
        st.bar_chart(pd.DataFrame.from_dict(engine_counts, orient="index", columns=["Bons"]))
    else:
        st.caption("Keine Daten.")
with c2:
    st.markdown("**Reconciliation Direction** (Σ items vs Total)")
    if recon_dirs:
        st.bar_chart(pd.DataFrame.from_dict(recon_dirs, orient="index", columns=["Bons"]))
        st.caption(
            "match=perfekt · undershoot=Σ<Total (Pfand normal) · "
            "overshoot=Σ>Total (Rabatt übersehen / Item dupliziert)"
        )
    else:
        st.caption("Keine Daten.")


# ---------------------------------------------------------------------------
# Bon Browser
# ---------------------------------------------------------------------------

st.markdown("---")
st.markdown(f"## 📋 Bon Browser ({len(receipts)})")

if not receipts:
    st.info("Keine Bons im gewählten Zeitraum / mit gewähltem Filter.")
    st.stop()


# Build table dataframe
def to_row(r: dict) -> dict:
    ocr = r.get("ocr") or {}
    recon = ocr.get("reconciliation") or {}
    esc = ocr.get("escalation") or {}
    merchant = r.get("merchant") or {}
    parsed = ocr.get("parsed") or {}
    created = r.get("createdAt")
    if hasattr(created, "to_datetime"):
        created_dt = created.to_datetime()
    elif isinstance(created, datetime):
        created_dt = created
    else:
        created_dt = None
    return {
        "id": r["_id"][:10],
        "_id_full": r["_id"],
        "created": created_dt.astimezone(BERLIN).strftime("%m-%d %H:%M") if created_dt else "?",
        "status": r.get("status"),
        "merchant": merchant.get("name") or merchant.get("raw") or parsed.get("merchant") or "?",
        "items": r.get("eligibleItemCount"),
        "total_eur": (r.get("bonTotalCents") or parsed.get("totalCents") or 0) / 100,
        "cashback_¢": r.get("cashbackCents", 0),
        "engine": ocr.get("engine"),
        "recon": recon.get("direction"),
        "Δ_eur": (recon.get("signedDeltaCents") / 100) if recon.get("signedDeltaCents") is not None else None,
        "esc_fired": "✓" if esc.get("fired") else "",
        "esc_won": "✓" if esc.get("swapped") else "",
        "lat_ms": ocr.get("latencyMs"),
        "reject": r.get("rejectReason"),
    }


# Pagination — show 20 per page, surface controls only when needed
PAGE_SIZE = 20
total_rows = len(receipts)
if total_rows > PAGE_SIZE:
    total_pages = (total_rows + PAGE_SIZE - 1) // PAGE_SIZE
    pcol1, pcol2 = st.columns([1, 5])
    with pcol1:
        page = st.number_input(
            "Seite",
            min_value=1,
            max_value=total_pages,
            value=1,
            step=1,
            key="bon_page",
        )
    with pcol2:
        st.caption(
            f"Seite {page} von {total_pages}  ·  {total_rows} Bons gesamt  ·  "
            f"{PAGE_SIZE} pro Seite"
        )
    page_start = (int(page) - 1) * PAGE_SIZE
    page_end = page_start + PAGE_SIZE
    page_receipts = receipts[page_start:page_end]
else:
    page_receipts = receipts

df = pd.DataFrame([to_row(r) for r in page_receipts])
display_df = df.drop(columns=["_id_full"])

# Click-to-select: st.dataframe with selection_mode='single-row' returns
# the selected indexes in the event object on rerun (Streamlit ≥1.35).
#
# Key includes the current page so the selection state resets cleanly
# when the user paginates (otherwise stale row indexes would point at
# wrong bons after page change).
current_page = int(st.session_state.get("bon_page", 1))
table_key = f"bon_table_p{current_page}"

selection_event = st.dataframe(
    display_df,
    use_container_width=True,
    hide_index=True,
    height=min(60 + 35 * len(page_receipts), 720),
    column_config={
        "id": st.column_config.TextColumn("ID", width="small"),
        "created": st.column_config.TextColumn("Created", width="small"),
        "status": st.column_config.TextColumn("Status", width="small"),
        "merchant": st.column_config.TextColumn("Merchant", width="medium"),
        "items": st.column_config.NumberColumn("Items", width="small"),
        "total_eur": st.column_config.NumberColumn("Total €", format="%.2f", width="small"),
        "cashback_¢": st.column_config.NumberColumn("Cashback ¢", width="small"),
        "engine": st.column_config.TextColumn("Engine", width="small"),
        "recon": st.column_config.TextColumn("Recon", width="small"),
        "Δ_eur": st.column_config.NumberColumn("Δ €", format="%.2f", width="small"),
        "esc_fired": st.column_config.TextColumn("Esc?", width="small"),
        "esc_won": st.column_config.TextColumn("Won?", width="small"),
        "lat_ms": st.column_config.NumberColumn("Lat ms", width="small"),
        "reject": st.column_config.TextColumn("Reject reason", width="large"),
    },
    selection_mode="single-row",
    on_select="rerun",
    key=table_key,
)


# ---------------------------------------------------------------------------
# Detail view — row-click is THE selection mechanism. Falls back to first
# bon of the current page so the detail panel is never empty.
# ---------------------------------------------------------------------------

# Pull the row index Streamlit returned for this rerun
sel_rows: list[int] = []
try:
    sel = getattr(selection_event, "selection", None) or (selection_event or {}).get("selection", {})
    sel_rows = list(getattr(sel, "rows", None) or sel.get("rows", []) or [])
except Exception:  # noqa: BLE001
    sel_rows = []

if sel_rows and 0 <= sel_rows[0] < len(page_receipts):
    selected_id = page_receipts[sel_rows[0]]["_id"]
    selection_origin = "row-click"
elif page_receipts:
    selected_id = page_receipts[0]["_id"]
    selection_origin = "default (first on page)"
else:
    selected_id = None
    selection_origin = "—"

selected = next((r for r in receipts if r["_id"] == selected_id), None)

st.markdown("---")
st.markdown(
    f"## 🔍 Bon-Detail "
    f"<span style='font-size:13px;color:#57606a;font-weight:400'>"
    f"({selection_origin}: <code>{selected_id[:10] if selected_id else '—'}</code>)"
    f"</span>",
    unsafe_allow_html=True,
)
st.caption(
    "👆 Klick eine Zeile in der Tabelle oben, um den Bon hier zu sehen. "
    "Wenn nichts gewählt: erste Zeile der aktuellen Seite."
)

# Cross-page picker (doesn't drive selection — opens that bon in a new page)
with st.expander("Bon von einer anderen Seite öffnen"):
    if total_rows > PAGE_SIZE:
        all_ids = [r["_id"] for r in receipts]
        cross_picked = st.selectbox(
            "Wähle einen Bon (auch über alle Seiten hinweg)",
            options=all_ids,
            format_func=lambda i: (
                f"{i[:10]}  ·  "
                f"{next(((r.get('merchant') or {}).get('name') or '?' for r in receipts if r['_id'] == i), '?')}"
                f"  ·  {next((r.get('status') for r in receipts if r['_id'] == i), '?')}"
            ),
            index=0,
            key="cross_page_picker",
        )
        if st.button("Auf diesen Bon springen"):
            target_idx = all_ids.index(cross_picked)
            target_page = (target_idx // PAGE_SIZE) + 1
            st.session_state.bon_page = target_page
            st.rerun()
    else:
        st.caption("Nur eine Seite — alle Bons sind oben in der Tabelle sichtbar.")


def render_status_pill(status: Optional[str]) -> str:
    cls = {
        "approved": "pill-approve",
        "review": "pill-review",
        "rejected": "pill-reject",
        "ocr_pending": "pill-pending",
        "matched": "pill-pending",
        "superseded": "pill-pending",
    }.get(status or "", "pill-pending")
    return f'<span class="pill {cls}">{(status or "?").upper()}</span>'


def render_engine_pill(engine: Optional[str]) -> str:
    if engine == "docai":
        cls = "pill-docai"
    elif engine == "cv-hybrid":
        cls = "pill-engine"
    else:
        cls = "pill-direct"
    return f'<span class="pill {cls}">{(engine or "—").upper()}</span>'


@st.cache_data(ttl=300, show_spinner=False)
def fetch_bon_image(storage_path: str, _v: int = 1) -> Optional[bytes]:
    if not storage_path:
        return None
    try:
        bucket = init_bucket()
        blob = bucket.blob(storage_path)
        return blob.download_as_bytes()
    except Exception as e:  # noqa: BLE001
        st.warning(f"Bild nicht ladbar: {e}")
        return None


if selected:
    cols = st.columns([1, 1.4])

    with cols[0]:
        # Bon image
        storage_path = (selected.get("storage") or {}).get("path")
        img_bytes = fetch_bon_image(storage_path) if storage_path else None
        if img_bytes:
            try:
                pil = Image.open(BytesIO(img_bytes))
                st.image(pil, use_container_width=True, caption=storage_path)
            except Exception as e:  # noqa: BLE001
                st.warning(f"Bild-Render-Fehler: {e}")
        else:
            st.info("Kein Bild verfügbar.")

        st.markdown("---")
        # Reprocess button — re-publishes PubSub
        st.markdown("**🔧 Debug**")
        if st.button("🔁 Reprocess this bon (re-publish PubSub)", key=f"reproc_{selected_id}"):
            try:
                publisher, topic_path = init_pubsub()
                payload = json.dumps(
                    {"cashbackId": selected_id, "uid": selected.get("userId")}
                ).encode("utf-8")
                future = publisher.publish(
                    topic_path,
                    payload,
                    uid=str(selected.get("userId") or ""),
                    cashbackId=selected_id,
                )
                msg_id = future.result(timeout=10)
                st.success(
                    f"✅ Republished. PubSub message id `{msg_id}`. "
                    f"Refresh in ~5–10 s um das Update zu sehen."
                )
            except Exception as e:  # noqa: BLE001
                st.error(f"Reprocess failed: {e}")

    with cols[1]:
        ocr = selected.get("ocr") or {}
        parsed = ocr.get("parsed") or {}
        recon = ocr.get("reconciliation") or {}
        esc = ocr.get("escalation") or {}
        merchant = selected.get("merchant") or {}
        capture = selected.get("capture") or {}
        forensics = capture.get("forensicFlags") or {}
        exif = capture.get("exif") or {}

        # Header pills
        pills = (
            render_status_pill(selected.get("status"))
            + render_engine_pill(ocr.get("engine"))
            + (
                f'<span class="pill pill-ok">⚡ Escalated → {"DocAI won" if esc.get("swapped") else "Primary kept"}</span>'
                if esc.get("fired")
                else ""
            )
        )
        st.markdown(pills, unsafe_allow_html=True)

        # Headline numbers
        st.markdown(f"### {merchant.get('name') or parsed.get('merchant') or '?'}")
        if merchant.get("displayName"):
            st.caption(merchant.get("displayName"))

        c1, c2, c3, c4 = st.columns(4)
        c1.metric(
            "Total €",
            f"{(selected.get('bonTotalCents') or parsed.get('totalCents') or 0) / 100:.2f}",
        )
        c2.metric("Σ Items €", f"{(recon.get('sumItemsCents') or 0) / 100:.2f}")
        delta_eur = (recon.get("signedDeltaCents") or 0) / 100
        delta_color = "🟢" if abs(delta_eur) <= 0.05 else "🟡" if abs(delta_eur) <= 0.50 else "🔴"
        c3.metric("Δ", f"{delta_color} {delta_eur:+.2f} €")
        c4.metric(
            "Cashback ¢",
            selected.get("cashbackCents") or 0,
            delta=f"{selected.get('eligibleItemCount') or 0} items",
        )

        # Reconciliation block
        st.markdown("**Reconciliation**")
        recon_str = (
            f"`direction={recon.get('direction')}`  "
            f"`ok={recon.get('ok')}`  "
            f"`|delta|={recon.get('deltaCents')}¢`  "
            f"`signed={recon.get('signedDeltaCents')}¢`"
        )
        st.caption(recon_str)

        # Escalation block (if fired)
        if esc.get("fired"):
            st.markdown("**Escalation Trail**")
            st.caption(
                f"primary engine `{esc.get('primaryEngine')}` Δ={esc.get('primaryDeltaCents')}¢ "
                f"({esc.get('primaryDirection')}) → DocAI Δ={esc.get('docaiDeltaCents')}¢ "
                f"({esc.get('docaiDirection')}) — DocAI took over: **{esc.get('swapped')}** · "
                f"DocAI latency {esc.get('docaiLatencyMs')} ms"
            )

        # Reject reason
        if selected.get("rejectReason"):
            st.error(f"**Reject reason:** `{selected.get('rejectReason')}`")

        # Items
        items = parsed.get("items") or []
        if items:
            st.markdown(f"**Items ({len(items)})**")
            items_df = pd.DataFrame(
                [
                    {
                        "name": it.get("name"),
                        "qty": it.get("qty"),
                        "€": (it.get("priceCents") or 0) / 100,
                        "category": it.get("category") or "",
                    }
                    for it in items
                ]
            )
            st.dataframe(
                items_df,
                use_container_width=True,
                hide_index=True,
                column_config={"€": st.column_config.NumberColumn("€", format="%.2f")},
            )

        # Forensic flags
        if exif or forensics:
            with st.expander("🔬 Forensik (dHash + EXIF)"):
                st.caption(f"Server dHash: `{capture.get('perceptualHashServer') or '—'}`")
                if exif:
                    st.caption(
                        f"EXIF · capturedAt: `{exif.get('capturedAtMs')}` · "
                        f"make: `{exif.get('make')}` · model: `{exif.get('model')}` · "
                        f"software: `{exif.get('software')}` · present: {exif.get('present')}"
                    )
                if forensics:
                    st.caption(
                        f"Flags · exifMissing: {forensics.get('exifMissing')} · "
                        f"suspiciousSoftware: {forensics.get('suspiciousSoftware')} · "
                        f"exifAgeMismatch: {forensics.get('exifAgeMismatch')} · "
                        f"exifAgeDays: {forensics.get('exifAgeDays')}"
                    )

        # Raw JSON
        with st.expander("Raw receipt JSON"):
            st.code(
                json.dumps(
                    {
                        k: v
                        for k, v in selected.items()
                        if k not in ("_id",)
                    },
                    indent=2,
                    default=str,
                    ensure_ascii=False,
                )[:10000],
                language="json",
            )


# Footer
st.markdown("---")
st.caption(
    "Read-only against production Firestore. Reprocess-Button schreibt nichts direkt — "
    "er triggert nur PubSub, was die deployed `processCashback` Function neu rechnen lässt. "
    "Cost-Schätzungen sind nicht exakt (Tokens werden noch nicht persistiert)."
)
