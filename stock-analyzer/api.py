"""FastAPI backend for the Stock DCF Analyzer mobile PWA."""
from __future__ import annotations

import json
import os
import sys
import threading
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

sys.path.insert(0, str(Path(__file__).parent))

from modules.stock_data import search_companies, get_comprehensive_data, get_key_metrics
from modules.dcf import run_dcf_model, enrich_with_advanced, sensitivity_table
from modules.hype import calculate_hype_score
from modules.ai_analysis import (
    check_ollama_status,
    get_available_models,
    extract_company_from_query,
    generate_dcf_narrative,
    analyze_news_sentiment,
    analyze_valuation_gap,
    calculate_confidence_score,
)
from modules.scores import (
    piotroski_f_score, altman_z_score,
    calculate_pentagon, historical_financials, stock_rank,
)

MOBILE_DIR = Path(__file__).parent / "mobile"
PRESETS = {
    "bear": {"risk_free": 0.050, "market_risk_premium": 0.065, "terminal_growth": 0.015, "growth_adjustment": -0.05},
    "base": {"risk_free": 0.045, "market_risk_premium": 0.055, "terminal_growth": 0.025, "growth_adjustment":  0.00},
    "bull": {"risk_free": 0.035, "market_risk_premium": 0.045, "terminal_growth": 0.035, "growth_adjustment":  0.05},
}

app = FastAPI(title="Stock DCF Analyzer API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_cache: dict[str, dict] = {}


# ─── SSE helper ──────────────────────────────────────────────────────────────

def _sse_stream(sync_gen_func, *args, **kwargs) -> StreamingResponse:
    """Wrap a synchronous generator as a true chunk-by-chunk SSE stream."""
    import queue as q_module

    chunk_q: q_module.Queue = q_module.Queue()

    def producer():
        try:
            for chunk in sync_gen_func(*args, **kwargs):
                chunk_q.put(chunk)
        finally:
            chunk_q.put(None)  # sentinel signals end

    def sync_sse():
        t = threading.Thread(target=producer, daemon=True)
        t.start()
        while True:
            chunk = chunk_q.get()  # blocks per chunk — not until all done
            if chunk is None:
                break
            payload = json.dumps({"content": chunk})
            yield f"data: {payload}\n\n"
        yield "data: [DONE]\n\n"
        t.join(timeout=5)

    return StreamingResponse(
        sync_sse(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ─── Static files ─────────────────────────────────────────────────────────────

@app.get("/")
async def index():
    return FileResponse(MOBILE_DIR / "index.html")

@app.get("/manifest.json")
async def manifest():
    return FileResponse(MOBILE_DIR / "manifest.json")

@app.get("/sw.js")
async def sw():
    return FileResponse(MOBILE_DIR / "sw.js", media_type="application/javascript")

if MOBILE_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(MOBILE_DIR)), name="static")


# ─── Status ───────────────────────────────────────────────────────────────────

@app.get("/api/status")
async def status():
    ollama_ok = check_ollama_status()
    models = get_available_models() if ollama_ok else []
    return {"ollama": ollama_ok, "models": models}


# ─── Search ───────────────────────────────────────────────────────────────────

@app.get("/api/search")
async def search(q: str = Query(..., min_length=1), model: Optional[str] = None):
    if not q.strip():
        raise HTTPException(400, "Query cannot be empty")
    company = extract_company_from_query(q, model)
    results = search_companies(company)
    return {"query": q, "extracted": company, "results": results}


# ─── Analyse ──────────────────────────────────────────────────────────────────

@app.post("/api/analyse/{ticker}")
async def analyse(ticker: str, preset: str = "base"):
    assumptions = PRESETS.get(preset, PRESETS["base"]).copy()
    ticker = ticker.upper().strip()

    sd = get_comprehensive_data(ticker)
    if not sd:
        raise HTTPException(404, f"No data found for {ticker}")

    km = get_key_metrics(sd)
    dcf = run_dcf_model(sd, assumptions)
    dcf = enrich_with_advanced(dcf, sd)
    hype = calculate_hype_score(sd)
    conf = calculate_confidence_score(dcf, km)

    # Scorecard
    piot   = piotroski_f_score(sd)
    altman = altman_z_score(sd)
    pent   = calculate_pentagon(sd, dcf, km)
    hist_f = historical_financials(sd)
    srank  = stock_rank(pent)

    # Sensitivity table → serialisable list of dicts
    try:
        st_df = sensitivity_table(dcf)
        st_data = {"columns": list(st_df.columns.astype(str)),
                   "index":   list(st_df.index.astype(str)),
                   "data":    st_df.values.tolist()}
    except Exception:
        st_data = None

    # FCF projection for chart
    proj = dcf.get("projected_fcf", [])
    proj_b = [round(v / 1e9, 2) for v in proj]

    # News (top 8)
    news = [
        {"title": n.get("title", ""), "publisher": n.get("publisher", ""),
         "link": n.get("link", ""), "providerPublishTime": n.get("providerPublishTime", 0)}
        for n in sd.get("news", [])[:8]
    ]

    # Price history (last 180 days, weekly sampled)
    hist = sd.get("history_1y")
    price_chart = []
    if hist is not None and not hist.empty:
        sampled = hist["Close"].iloc[::5].tail(36)
        price_chart = [
            {"t": str(i.date()), "v": round(float(v), 2)}
            for i, v in sampled.items()
        ]

    payload = {
        "ticker": ticker,
        "preset": preset,
        "key_metrics": _sanitise(km),
        "dcf": _sanitise(dcf),
        "hype": _sanitise(hype),
        "confidence": _sanitise(conf),
        "scores": {
            "piotroski": _sanitise(piot),
            "altman":    _sanitise(altman),
            "pentagon":  _sanitise(pent),
            "history":   _sanitise(hist_f),
            "rank":      _sanitise(srank),
        },
        "sensitivity": st_data,
        "fcf_projection": proj_b,
        "price_chart": price_chart,
        "news": news,
    }

    _cache[ticker] = {"key_metrics": km, "dcf": dcf, "stock_data": sd}
    return payload


# ─── AI streaming endpoints ───────────────────────────────────────────────────

@app.get("/api/ai/dcf")
async def ai_dcf(ticker: str = Query(...), model: str = Query("llama3.2")):
    cached = _cache.get(ticker.upper())
    if not cached:
        raise HTTPException(404, "Run /api/analyse first")
    return _sse_stream(generate_dcf_narrative, cached["key_metrics"], cached["dcf"], model)


@app.get("/api/ai/news")
async def ai_news(ticker: str = Query(...), model: str = Query("llama3.2")):
    cached = _cache.get(ticker.upper())
    if not cached:
        raise HTTPException(404, "Run /api/analyse first")
    news_items = cached["stock_data"].get("news", [])
    name = cached["key_metrics"].get("name", ticker)
    return _sse_stream(analyze_news_sentiment, news_items, name, model)


@app.get("/api/ai/valuation")
async def ai_valuation(ticker: str = Query(...), model: str = Query("llama3.2")):
    cached = _cache.get(ticker.upper())
    if not cached:
        raise HTTPException(404, "Run /api/analyse first")
    return _sse_stream(analyze_valuation_gap, cached["dcf"], cached["key_metrics"], model)


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _sanitise(obj):
    """Recursively make an object JSON-serialisable."""
    import numpy as np
    import pandas as pd
    import math
    if obj is None:
        return None
    if isinstance(obj, dict):
        return {k: _sanitise(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_sanitise(v) for v in obj]
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (np.floating,)):
        v = float(obj)
        return None if (math.isnan(v) or math.isinf(v)) else v
    if isinstance(obj, (np.ndarray,)):
        return _sanitise(obj.tolist())
    if isinstance(obj, pd.DataFrame):
        return None
    if isinstance(obj, pd.Series):
        return None
    if isinstance(obj, float):
        return None if (math.isnan(obj) or math.isinf(obj)) else obj
    return obj


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8080))
    uvicorn.run("api:app", host="0.0.0.0", port=port, reload=False)
