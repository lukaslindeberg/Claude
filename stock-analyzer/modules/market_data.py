"""
Live market inputs for the risk view — the Treasury curve, corporate bond
spreads by credit rating, factor ETF prices, FX and industry peers.

Every source degrades gracefully (FRED → Yahoo → a static snapshot) and reports
where its numbers came from, so the UI can say when it's showing estimates.
Cached fetchers raise on failure: Streamlit doesn't cache exceptions, so a
source that's down is retried on the next run instead of being remembered.
"""
from __future__ import annotations

import io
from concurrent.futures import ThreadPoolExecutor

import pandas as pd
import requests
import streamlit as st
import yfinance as yf

from modules.risk import annual_volatility

_UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}

# ICE BofA US corporate option-adjusted spreads by rating, published daily on FRED.
FRED_OAS = {
    "AAA": "BAMLC0A1CAAA", "AA": "BAMLC0A2CAA", "A": "BAMLC0A3CA",
    "BBB": "BAMLC0A4CBBB", "BB": "BAMLH0A1HYBB", "B": "BAMLH0A2HYB",
    "CCC": "BAMLH0A3HYC",
}
FRED_TREASURY = {
    0.25: "DGS3MO", 1.0: "DGS1", 2.0: "DGS2", 5.0: "DGS5",
    7.0: "DGS7", 10.0: "DGS10", 20.0: "DGS20", 30.0: "DGS30",
}
YAHOO_TREASURY = {0.25: "^IRX", 5.0: "^FVX", 10.0: "^TNX", 30.0: "^TYX"}

# Used only when no live source answers — typical recent levels, flagged in the UI.
FALLBACK_TREASURY = {0.25: 0.040, 1.0: 0.037, 2.0: 0.036, 5.0: 0.037,
                     7.0: 0.039, 10.0: 0.041, 20.0: 0.046, 30.0: 0.047}
FALLBACK_OAS = {"AAA": 0.0040, "AA": 0.0050, "A": 0.0075, "BBB": 0.0105,
                "BB": 0.0190, "B": 0.0300, "CCC": 0.0850}

# SPDR sector ETFs — the "industry" factor in the risk decomposition.
SECTOR_ETFS = {
    "Technology": "XLK", "Healthcare": "XLV", "Financial Services": "XLF",
    "Consumer Cyclical": "XLY", "Consumer Defensive": "XLP", "Energy": "XLE",
    "Industrials": "XLI", "Basic Materials": "XLB", "Real Estate": "XLRE",
    "Utilities": "XLU", "Communication Services": "XLC",
}
MARKET_ETF = "SPY"


# ─── Rates & credit spreads ──────────────────────────────────────────────────

def _fred_latest(series_id: str) -> tuple[float, str] | None:
    """Latest observation of a FRED series (as a decimal) via the public CSV."""
    try:
        r = requests.get("https://fred.stlouisfed.org/graph/fredgraph.csv",
                         params={"id": series_id}, headers=_UA, timeout=8)
        if r.status_code != 200:
            return None
        df = pd.read_csv(io.StringIO(r.text))
        vals = pd.to_numeric(df.iloc[:, 1], errors="coerce")
        ok = vals.dropna()
        if ok.empty:
            return None
        i = ok.index[-1]
        return float(vals[i]) / 100.0, str(df.iloc[i, 0])
    except Exception:
        return None


@st.cache_data(ttl=3 * 3600, show_spinner=False)
def _fred_bundle() -> dict:
    ids = {("oas", k): v for k, v in FRED_OAS.items()}
    ids.update({("tsy", k): v for k, v in FRED_TREASURY.items()})
    with ThreadPoolExecutor(max_workers=8) as ex:
        res = dict(zip(ids, ex.map(_fred_latest, ids.values())))
    got = {k: v for k, v in res.items() if v}
    if not got:
        raise RuntimeError("FRED unreachable")
    return got


@st.cache_data(ttl=3 * 3600, show_spinner=False)
def _yahoo_treasury() -> dict[float, float]:
    df = yf.download(list(YAHOO_TREASURY.values()), period="10d",
                     progress=False, auto_adjust=False)
    close = df["Close"] if "Close" in df else pd.DataFrame()
    out = {}
    for t, sym in YAHOO_TREASURY.items():
        if sym in close:
            s = close[sym].dropna()
            if len(s):
                out[t] = float(s.iloc[-1]) / 100.0
    if not out:
        raise RuntimeError("Yahoo Treasury yields unavailable")
    return out


def get_credit_market() -> dict:
    """Treasury curve + corporate spreads by rating, with source labels."""
    try:
        fred = _fred_bundle()
    except Exception:
        fred = {}

    oas = {b: fred[("oas", b)][0] for b in FRED_OAS if ("oas", b) in fred}
    dates = [fred[("oas", b)][1] for b in oas]
    if len(oas) == len(FRED_OAS):
        oas_src = "ICE BofA via FRED"
    elif oas:
        oas_src = "ICE BofA via FRED (partly estimated)"
    else:
        oas_src = "typical levels — live spreads unavailable"
    oas = {**FALLBACK_OAS, **oas}

    tsy = {t: fred[("tsy", t)][0] for t in FRED_TREASURY if ("tsy", t) in fred}
    tsy_src = "US Treasury via FRED"
    if len(tsy) < 3:
        try:
            tsy = {**_yahoo_treasury(), **tsy}
            tsy_src = "US Treasury via Yahoo Finance"
        except Exception:
            pass
    if len(tsy) < 2:
        tsy, tsy_src = dict(FALLBACK_TREASURY), "typical levels — live yields unavailable"

    return {
        "treasury": dict(sorted(tsy.items())), "treasury_source": tsy_src,
        "oas": oas, "oas_source": oas_src,
        "as_of": max(dates) if dates else None,
        "live": bool(fred) or "Yahoo" in tsy_src,
    }


# ─── Factor prices & FX ──────────────────────────────────────────────────────

@st.cache_data(ttl=6 * 3600, show_spinner=False)
def _download_closes(symbols: tuple[str, ...], period: str) -> pd.DataFrame:
    df = yf.download(list(symbols), period=period, auto_adjust=True, progress=False)
    close = df["Close"] if "Close" in df else pd.DataFrame()
    if isinstance(close, pd.Series):
        close = close.to_frame(symbols[0])
    close = close.dropna(how="all")
    if close.empty:
        raise RuntimeError(f"No prices for {symbols}")
    return close


def get_factor_prices(sector: str | None) -> dict:
    """2-year prices for the market (SPY) and the company's sector ETF."""
    etf = SECTOR_ETFS.get(sector or "")
    syms = (MARKET_ETF,) + ((etf,) if etf else ())
    try:
        close = _download_closes(syms, "2y")
    except Exception:
        return {"market": None, "industry": None, "industry_etf": etf}
    col = lambda s: close[s].dropna() if s in close else None
    return {"market": col(MARKET_ETF), "industry": col(etf) if etf else None,
            "industry_etf": etf}


@st.cache_data(ttl=12 * 3600, show_spinner=False)
def _fx(pair: str) -> float:
    s = yf.Ticker(pair).history(period="5d")["Close"].dropna()
    if s.empty:
        raise RuntimeError(f"No FX for {pair}")
    return float(s.iloc[-1])


def get_fx_rate(from_ccy: str | None, to_ccy: str | None) -> float | None:
    """Units of `to_ccy` per 1 `from_ccy` (1.0 when they match)."""
    if not from_ccy or not to_ccy or from_ccy == to_ccy:
        return 1.0
    try:
        return _fx(f"{from_ccy}{to_ccy}=X")
    except Exception:
        return None


# ─── Industry peers ──────────────────────────────────────────────────────────

@st.cache_data(ttl=24 * 3600, show_spinner=False)
def _industry_constituents(industry_key: str) -> list[str]:
    top = yf.Industry(industry_key).top_companies
    if top is None or top.empty:
        raise RuntimeError("No industry constituents")
    return list(top.sort_values("market weight", ascending=False).index)


@st.cache_data(ttl=24 * 3600, show_spinner=False)
def _similar_symbols(ticker: str) -> list[str]:
    r = requests.get(
        f"https://query2.finance.yahoo.com/v6/finance/recommendationsbysymbol/{ticker}",
        headers=_UA, timeout=8)
    recs = r.json()["finance"]["result"][0]["recommendedSymbols"]
    syms = [x["symbol"] for x in recs if x.get("symbol")]
    if not syms:
        raise RuntimeError("No similar symbols")
    return syms


def _peer_row(sym: str) -> dict | None:
    try:
        info = yf.Ticker(sym).info
    except Exception:
        return None
    if not info or not info.get("marketCap"):
        return None
    ebitda = info.get("ebitda")
    net_debt = (info.get("totalDebt") or 0) - (info.get("totalCash") or 0)
    return {
        "symbol": sym,
        "name": info.get("shortName") or info.get("longName") or sym,
        "market_cap": info.get("marketCap"),
        "ebitda_margin": info.get("ebitdaMargins"),
        "net_debt_ebitda": net_debt / ebitda if ebitda and ebitda > 0 else None,
        "beta": info.get("beta"),
    }


@st.cache_data(ttl=6 * 3600, show_spinner=False)
def _peer_snapshot(symbols: tuple[str, ...]) -> pd.DataFrame:
    with ThreadPoolExecutor(max_workers=8) as ex:
        rows = [r for r in ex.map(_peer_row, symbols) if r]
    if not rows:
        raise RuntimeError("No peer data")
    df = pd.DataFrame(rows)
    try:
        close = _download_closes(tuple(df["symbol"]), "1y")
        df["volatility"] = [annual_volatility(close[s]) if s in close else None
                            for s in df["symbol"]]
    except Exception:
        df["volatility"] = None
    return df


def get_peers(industry_key: str | None, ticker: str, n: int = 8) -> tuple[pd.DataFrame, str]:
    """Up to `n` industry peers (largest first) and a label for where they came from."""
    cands, src = [], ""
    if industry_key:
        try:
            cands, src = _industry_constituents(industry_key), "Yahoo Finance industry constituents"
        except Exception:
            pass
    if len(cands) < 3:
        try:
            cands, src = _similar_symbols(ticker), "Yahoo Finance similar companies"
        except Exception:
            pass
    syms = tuple(s for s in cands if s and s.upper() != ticker.upper())[:n]
    if not syms:
        return pd.DataFrame(), ""
    try:
        return _peer_snapshot(syms), src
    except Exception:
        return pd.DataFrame(), ""
