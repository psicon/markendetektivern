"""
Phase-0 OCR validation CLI.

Reads every image in `bons/`, sends it to Gemini 2.5 Flash with a
strict JSON schema, writes a per-bon JSON to `output/<filename>.json`
and a `output/summary.csv` with the headline numbers per bon.

Usage:
    export GEMINI_API_KEY=AIza...
    python validate.py                # default: gemini-2.5-flash
    python validate.py --model gemini-2.5-flash-lite
    python validate.py --model gemini-2.5-pro

The exit code is 0 on a clean run, even if individual bons fail —
errors are captured per-row in the summary.
"""

from __future__ import annotations

import argparse
import csv
import json
import mimetypes
import os
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
from google import genai
from google.genai import types
from pydantic import ValidationError

from prompts import SYSTEM_PROMPT, VERSION as PROMPT_VERSION, build_user_prompt
from schema import Receipt

# ---------------------------------------------------------------------------
# Setup
# ---------------------------------------------------------------------------

load_dotenv()

ROOT = Path(__file__).parent
BONS_DIR = ROOT / "bons"
OUT_DIR = ROOT / "output"
SUMMARY_CSV = OUT_DIR / "summary.csv"

SUPPORTED_EXT = {".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif", ".pdf"}


# ---------------------------------------------------------------------------
# Model call
# ---------------------------------------------------------------------------


@dataclass
class ExtractResult:
    bon: str
    ok: bool
    model: str
    promptVersion: str
    latencyMs: int
    inputTokens: Optional[int]
    outputTokens: Optional[int]
    receipt: Optional[Receipt]
    error: Optional[str]
    rawText: Optional[str]


def extract_one(client: genai.Client, model: str, image_path: Path) -> ExtractResult:
    started = time.monotonic()
    try:
        mime, _ = mimetypes.guess_type(str(image_path))
        if not mime:
            mime = "image/jpeg"

        with open(image_path, "rb") as f:
            data = f.read()

        response = client.models.generate_content(
            model=model,
            contents=[
                types.Content(
                    role="user",
                    parts=[
                        types.Part.from_bytes(data=data, mime_type=mime),
                        types.Part.from_text(text=build_user_prompt()),
                    ],
                ),
            ],
            config=types.GenerateContentConfig(
                system_instruction=SYSTEM_PROMPT,
                temperature=0.1,
                response_mime_type="application/json",
                response_schema=Receipt,
            ),
        )

        latency_ms = int((time.monotonic() - started) * 1000)
        raw_text = response.text or ""

        usage = response.usage_metadata
        in_tok = getattr(usage, "prompt_token_count", None) if usage else None
        out_tok = getattr(usage, "candidates_token_count", None) if usage else None

        try:
            payload = json.loads(raw_text)
        except json.JSONDecodeError as e:
            return ExtractResult(
                bon=image_path.name,
                ok=False,
                model=model,
                promptVersion=PROMPT_VERSION,
                latencyMs=latency_ms,
                inputTokens=in_tok,
                outputTokens=out_tok,
                receipt=None,
                error=f"json.decode: {e}",
                rawText=raw_text,
            )

        try:
            receipt = Receipt.model_validate(payload)
        except ValidationError as e:
            return ExtractResult(
                bon=image_path.name,
                ok=False,
                model=model,
                promptVersion=PROMPT_VERSION,
                latencyMs=latency_ms,
                inputTokens=in_tok,
                outputTokens=out_tok,
                receipt=None,
                error=f"schema: {e.errors()[:2]}",
                rawText=raw_text,
            )

        return ExtractResult(
            bon=image_path.name,
            ok=True,
            model=model,
            promptVersion=PROMPT_VERSION,
            latencyMs=latency_ms,
            inputTokens=in_tok,
            outputTokens=out_tok,
            receipt=receipt,
            error=None,
            rawText=raw_text,
        )

    except Exception as e:  # noqa: BLE001 — we want a clean per-bon error row
        latency_ms = int((time.monotonic() - started) * 1000)
        return ExtractResult(
            bon=image_path.name,
            ok=False,
            model=model,
            promptVersion=PROMPT_VERSION,
            latencyMs=latency_ms,
            inputTokens=None,
            outputTokens=None,
            receipt=None,
            error=f"{type(e).__name__}: {e}",
            rawText=None,
        )


# ---------------------------------------------------------------------------
# Cost helpers (for the summary)
# Gemini 2.5 Flash text+image pricing as of 2026-05.
# Numbers are USD per 1M tokens.
# ---------------------------------------------------------------------------

PRICING = {
    "gemini-2.5-flash":      {"in": 0.30,  "out": 2.50},
    "gemini-2.5-flash-lite": {"in": 0.075, "out": 0.30},
    "gemini-2.5-pro":        {"in": 1.25,  "out": 10.00},
}


def estimate_cents(model: str, in_tok: Optional[int], out_tok: Optional[int]) -> Optional[float]:
    p = PRICING.get(model)
    if not p or in_tok is None or out_tok is None:
        return None
    usd = (in_tok / 1_000_000.0) * p["in"] + (out_tok / 1_000_000.0) * p["out"]
    return round(usd * 100, 4)  # in cents


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> int:
    parser = argparse.ArgumentParser(description="Phase-0 OCR validator (Gemini)")
    parser.add_argument(
        "--model",
        default="gemini-2.5-flash",
        choices=sorted(PRICING.keys()),
        help="Which Gemini model to use (default: gemini-2.5-flash)",
    )
    parser.add_argument("--bons", default=str(BONS_DIR), help="Folder with bon images")
    parser.add_argument("--out", default=str(OUT_DIR), help="Output folder")
    parser.add_argument("--limit", type=int, default=0, help="Max bons (0 = all)")
    args = parser.parse_args()

    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        print("ERROR: set GEMINI_API_KEY in the environment (or .env)", file=sys.stderr)
        return 2

    bons_dir = Path(args.bons)
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    if not bons_dir.exists():
        print(f"ERROR: bons folder {bons_dir} does not exist", file=sys.stderr)
        return 2

    images = sorted(
        [p for p in bons_dir.iterdir() if p.suffix.lower() in SUPPORTED_EXT and not p.name.startswith(".")]
    )
    if args.limit > 0:
        images = images[: args.limit]

    if not images:
        print(
            f"⚠️  No bons found in {bons_dir}. Supported: {sorted(SUPPORTED_EXT)}",
            file=sys.stderr,
        )
        return 1

    client = genai.Client(api_key=api_key)
    print(f"→ {len(images)} bon(s) | model={args.model} | prompt={PROMPT_VERSION}")
    print()

    rows: list[dict] = []
    for idx, img in enumerate(images, start=1):
        print(f"[{idx}/{len(images)}] {img.name} ... ", end="", flush=True)
        result = extract_one(client, args.model, img)

        per_bon_path = out_dir / f"{img.stem}.json"
        per_bon_path.write_text(
            json.dumps(
                {
                    "bon": result.bon,
                    "ok": result.ok,
                    "model": result.model,
                    "promptVersion": result.promptVersion,
                    "latencyMs": result.latencyMs,
                    "inputTokens": result.inputTokens,
                    "outputTokens": result.outputTokens,
                    "error": result.error,
                    "receipt": result.receipt.model_dump() if result.receipt else None,
                    "rawText": result.rawText if not result.ok else None,
                },
                indent=2,
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )

        cost_cents = estimate_cents(result.model, result.inputTokens, result.outputTokens)

        if result.ok and result.receipt:
            r = result.receipt
            sum_items = sum(it.priceCents for it in r.items)
            total = r.totalCents or 0
            delta = abs(total - sum_items) if total else None
            print(
                f"OK  {len(r.items)} items, total={total/100:.2f}€, "
                f"Σitems={sum_items/100:.2f}€, Δ={delta/100 if delta is not None else '?':>4}, "
                f"{result.latencyMs} ms"
            )
            rows.append(
                {
                    "bon": result.bon,
                    "ok": True,
                    "model": result.model,
                    "promptVersion": result.promptVersion,
                    "isReceipt": r.isReceipt,
                    "merchant": r.merchant or "",
                    "bonDate": r.bonDate or "",
                    "bonTime": r.bonTime or "",
                    "itemCount": len(r.items),
                    "totalEur": (r.totalCents or 0) / 100,
                    "sumItemsEur": sum_items / 100,
                    "deltaEur": (delta / 100) if delta is not None else "",
                    "ocrConfidence": r.ocrConfidence if r.ocrConfidence is not None else "",
                    "suspiciousManipulation": r.suspiciousManipulation,
                    "latencyMs": result.latencyMs,
                    "inputTokens": result.inputTokens or "",
                    "outputTokens": result.outputTokens or "",
                    "estCostCents": cost_cents if cost_cents is not None else "",
                    "error": "",
                }
            )
        else:
            print(f"FAIL  {result.error}")
            rows.append(
                {
                    "bon": result.bon,
                    "ok": False,
                    "model": result.model,
                    "promptVersion": result.promptVersion,
                    "isReceipt": "",
                    "merchant": "",
                    "bonDate": "",
                    "bonTime": "",
                    "itemCount": "",
                    "totalEur": "",
                    "sumItemsEur": "",
                    "deltaEur": "",
                    "ocrConfidence": "",
                    "suspiciousManipulation": "",
                    "latencyMs": result.latencyMs,
                    "inputTokens": result.inputTokens or "",
                    "outputTokens": result.outputTokens or "",
                    "estCostCents": cost_cents if cost_cents is not None else "",
                    "error": (result.error or "")[:120],
                }
            )

    if rows:
        SUMMARY_CSV.parent.mkdir(parents=True, exist_ok=True)
        with open(SUMMARY_CSV, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
            writer.writeheader()
            writer.writerows(rows)

    ok_rows = [r for r in rows if r["ok"]]
    print()
    print("─" * 70)
    print(f"Bons:               {len(rows)}")
    print(f"OK:                 {len(ok_rows)}  ({len(ok_rows)*100//max(1,len(rows))}%)")
    print(f"FAIL:               {len(rows) - len(ok_rows)}")
    if ok_rows:
        avg_latency = sum(r["latencyMs"] for r in ok_rows) / len(ok_rows)
        print(f"Avg latency:        {avg_latency:.0f} ms")
        cost_sum = sum(r["estCostCents"] for r in ok_rows if isinstance(r["estCostCents"], (int, float)))
        if cost_sum:
            print(f"Sum est cost:       {cost_sum:.4f} ¢ ({cost_sum/100:.4f} $)")
            avg_cost = cost_sum / len(ok_rows)
            print(f"Avg cost / bon:     {avg_cost:.4f} ¢")
            print(f"→ at 1.5k bons/day: {(avg_cost*1500*30)/100:.2f} $/month")
        deltas = [r["deltaEur"] for r in ok_rows if isinstance(r["deltaEur"], (int, float))]
        if deltas:
            avg_delta = sum(deltas) / len(deltas)
            print(f"Avg total/Σitems Δ: {avg_delta:.2f} €")
            within_5c = sum(1 for d in deltas if d <= 0.05)
            print(f"Bons with Δ ≤ 0.05€: {within_5c}/{len(deltas)} ({within_5c*100//len(deltas)}%)")
    print(f"Per-bon JSONs:      {OUT_DIR}/*.json")
    print(f"Summary CSV:        {SUMMARY_CSV}")
    print("─" * 70)
    return 0


if __name__ == "__main__":
    sys.exit(main())
