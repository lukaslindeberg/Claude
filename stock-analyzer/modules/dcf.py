"""
Professional 3-stage DCF model with reverse DCF, Monte Carlo simulation,
sector multiples cross-validation, and TTM cash flow calculation.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from datetime import datetime


# ─── Sector multiples (Damodaran-inspired forward averages) ──────────────────
SECTOR_MULTIPLES: dict[str, dict] = {
    "Technology":            {"pe": 28, "ev_ebitda": 22, "ps": 6.0},
    "Healthcare":            {"pe": 24, "ev_ebitda": 16, "ps": 4.5},
    "Financial Services":    {"pe": 14, "ev_ebitda": None, "ps": 2.5},
    "Consumer Cyclical":     {"pe": 20, "ev_ebitda": 13, "ps": 1.3},
    "Consumer Defensive":    {"pe": 22, "ev_ebitda": 14, "ps": 2.0},
    "Energy":                {"pe": 12, "ev_ebitda":  8, "ps": 0.9},
    "Utilities":             {"pe": 17, "ev_ebitda": 11, "ps": 2.2},
    "Industrials":           {"pe": 20, "ev_ebitda": 13, "ps": 1.7},
    "Basic Materials":       {"pe": 15, "ev_ebitda":  9, "ps": 1.3},
    "Real Estate":           {"pe": 32, "ev_ebitda": 18, "ps": 5.5},
    "Communication Services":{"pe": 20, "ev_ebitda": 13, "ps": 2.8},
}


# ─── DataFrame helpers ────────────────────────────────────────────────────────

def _row(df: pd.DataFrame, keys: list[str]) -> pd.Series | None:
    """Return first matching row from a DataFrame."""
    for k in keys:
        if df is not None and not df.empty and k in df.index:
            return df.loc[k].dropna()
    return None


# ─── TTM FCF extraction ───────────────────────────────────────────────────────

def get_ttm_fcf(stock_data: dict) -> tuple[float | None, str]:
    """
    Compute trailing-twelve-month FCF from quarterly cash flow data.
    Returns (ttm_fcf, source_label).
    """
    qcf = stock_data.get("quarterly_cashflow", pd.DataFrame())
    if qcf is not None and not qcf.empty:
        op = _row(qcf, ["Operating Cash Flow", "Total Cash From Operating Activities",
                         "Cash From Operating Activities"])
        cx = _row(qcf, ["Capital Expenditure", "Capital Expenditures",
                         "Purchase Of Property Plant And Equipment"])
        if op is not None and len(op) >= 4:
            ttm_op = float(op.iloc[:4].sum())
            if cx is not None and len(cx) >= 4:
                ttm_cx = float(cx.iloc[:4].sum())  # CapEx is negative in yfinance
                return ttm_op + ttm_cx, "quarterly_ttm"
            return ttm_op, "quarterly_op_only"
    return None, "annual"


def extract_fcf_history(stock_data: dict) -> tuple[list, list, str]:
    """
    Return (fcf_list, year_list, source).
    Lists are newest-first (yfinance ordering).
    Primary source is annual cash flow; TTM is surfaced via get_ttm_fcf().
    """
    cf = stock_data.get("cashflow", pd.DataFrame())
    info = stock_data.get("info", {})

    if cf is not None and not cf.empty:
        s = _row(cf, ["Free Cash Flow", "FreeCashFlow"])
        if s is not None and len(s):
            return s.tolist(), [d.year for d in s.index], "direct"

        op = _row(cf, ["Operating Cash Flow", "Total Cash From Operating Activities",
                        "Cash From Operating Activities"])
        cx = _row(cf, ["Capital Expenditure", "Capital Expenditures",
                        "Purchase Of Property Plant And Equipment"])
        if op is not None:
            if cx is not None:
                aligned = pd.concat([op, cx], axis=1).dropna()
                if not aligned.empty:
                    fcf = (aligned.iloc[:, 0] + aligned.iloc[:, 1]).tolist()
                    return fcf, [d.year for d in aligned.index], "calculated"
            return op.tolist(), [d.year for d in op.index], "operating_cf"

    rev = info.get("totalRevenue", 0) or 0
    margin = info.get("operatingMargins", 0.10) or 0.10
    return [rev * margin * 0.79], [datetime.now().year], "estimated"


# ─── Effective tax rate ───────────────────────────────────────────────────────

def effective_tax_rate(stock_data: dict) -> float:
    """Calculate normalised effective tax rate from last 1-3 years of financials."""
    fin = stock_data.get("financials", pd.DataFrame())
    if fin is not None and not fin.empty:
        pretax = _row(fin, ["Pretax Income", "Income Before Tax", "Earnings Before Tax"])
        tax = _row(fin, ["Income Tax Expense", "Tax Provision", "Taxes"])
        if pretax is not None and tax is not None:
            n = min(3, len(pretax), len(tax))
            rates = []
            for i in range(n):
                pt = float(pretax.iloc[i]) if pretax.iloc[i] else 0
                tx = float(tax.iloc[i]) if tax.iloc[i] else 0
                if pt > 0 and tx:
                    r = abs(tx) / pt
                    if 0.05 <= r <= 0.45:
                        rates.append(r)
            if rates:
                return float(np.mean(rates))
    return 0.21


# ─── Growth rate analysis ─────────────────────────────────────────────────────

def calculate_growth_rates(fcf_history: list, info: dict) -> dict:
    """
    Blend analyst estimates with historical CAGR.
    Returns cagr, recent_growth, analyst_growth, blended_growth, stability.
    """
    valid = [v for v in fcf_history if v and v > 0]

    # Historical CAGR
    if len(fcf_history) >= 2 and fcf_history[-1] and fcf_history[-1] > 0 and fcf_history[0] > 0:
        n = len(fcf_history) - 1
        cagr = float(np.clip((fcf_history[0] / fcf_history[-1]) ** (1 / n) - 1, -0.5, 1.0))
    else:
        cagr = 0.08

    # Recent 1-year growth
    if len(fcf_history) >= 2 and fcf_history[1] and fcf_history[1] != 0:
        recent = float(np.clip((fcf_history[0] - fcf_history[1]) / abs(fcf_history[1]), -0.5, 1.0))
    else:
        recent = cagr

    # Analyst consensus from yfinance info
    analyst_candidates = [
        info.get("earningsGrowth"),
        info.get("revenueGrowth"),
        info.get("earningsQuarterlyGrowth"),
    ]
    analyst_vals = [float(v) for v in analyst_candidates if v is not None and -0.9 < v < 3.0]
    analyst_growth = float(np.mean(analyst_vals)) if analyst_vals else None

    # Blended: if analyst data available weight it 40%
    if analyst_growth is not None:
        blended = 0.35 * cagr + 0.30 * recent + 0.35 * analyst_growth
    else:
        blended = 0.60 * cagr + 0.40 * recent
    blended = float(np.clip(blended, -0.20, 0.50))

    # Stability
    recent3 = [v for v in fcf_history[:3] if v]
    if len(recent3) >= 3 and all(v > 0 for v in recent3):
        cv = np.std(recent3) / abs(np.mean(recent3)) if np.mean(recent3) != 0 else 1
        stability = "high" if cv < 0.25 else ("medium" if cv < 0.55 else "low")
    elif valid:
        stability = "medium"
    else:
        stability = "low"

    return {
        "cagr": cagr,
        "recent_growth": recent,
        "analyst_growth": analyst_growth,
        "blended": blended,
        "stability": stability,
    }


# ─── WACC ─────────────────────────────────────────────────────────────────────

def calculate_wacc(stock_data: dict, assumptions: dict) -> dict:
    """Calculate WACC with de-levered beta and effective tax rate."""
    info = stock_data.get("info", {})
    rf  = assumptions.get("risk_free_rate", 0.045)
    mrp = assumptions.get("market_risk_premium", 0.055)

    beta = float(info.get("beta") or 1.0)
    if not (0.01 < beta < 5.0):
        beta = 1.0
    cost_equity = rf + beta * mrp

    mkt_cap    = float(info.get("marketCap",  0) or 0)
    total_debt = float(info.get("totalDebt",  0) or 0)
    total_cap  = mkt_cap + total_debt

    if total_cap == 0:
        return {
            "wacc": cost_equity, "cost_of_equity": cost_equity,
            "cost_of_debt": 0.05, "after_tax_cost_of_debt": 0.0395,
            "equity_weight": 1.0, "debt_weight": 0.0,
            "beta": beta, "tax_rate": 0.21,
        }

    eq_w = mkt_cap / total_cap
    dt_w = total_debt / total_cap

    # Cost of debt from financials
    cod = 0.05
    fin = stock_data.get("financials", pd.DataFrame())
    if fin is not None and not fin.empty and total_debt > 0:
        ie = _row(fin, ["Interest Expense", "Interest And Debt Expense"])
        if ie is not None and len(ie):
            raw = abs(float(ie.iloc[0]))
            if raw > 0:
                cod = float(np.clip(raw / total_debt, 0.015, 0.20))

    tax = effective_tax_rate(stock_data)
    atcod = cod * (1 - tax)
    wacc = eq_w * cost_equity + dt_w * atcod

    return {
        "wacc": wacc, "cost_of_equity": cost_equity,
        "cost_of_debt": cod, "after_tax_cost_of_debt": atcod,
        "equity_weight": eq_w, "debt_weight": dt_w,
        "beta": beta, "tax_rate": tax,
    }


# ─── 3-Stage FCF Projection ───────────────────────────────────────────────────

def project_fcf_3stage(current_fcf: float, growth: dict, assumptions: dict) -> dict:
    """
    Project FCF over 10 years with three stages:
      Stage 1: Years 1-5  — high growth (blended analyst + historical)
      Stage 2: Years 6-10 — fade from Stage-1 growth toward terminal growth
    Returns projected list (10 items) and per-year growth rates.
    """
    s1_years = 5
    s2_years = 5
    terminal_g = assumptions.get("terminal_growth", 0.025)
    adj       = assumptions.get("growth_adjustment", 0.0)

    stage1_g = float(np.clip(growth["blended"] + adj, -0.20, 0.50))

    projected = []
    yr_growths = []
    for yr in range(1, s1_years + s2_years + 1):
        if yr <= s1_years:
            g = stage1_g
        else:
            fade = (yr - s1_years) / s2_years
            g = stage1_g * (1 - fade) + terminal_g * fade
        prev = projected[-1] if projected else current_fcf
        projected.append(prev * (1 + g))
        yr_growths.append(g)

    return {
        "fcf": projected,
        "growth_rates": yr_growths,
        "stage1_growth": stage1_g,
        "stage1_years": s1_years,
        "stage2_years": s2_years,
    }


# ─── Reverse DCF ──────────────────────────────────────────────────────────────

def reverse_dcf(
    current_price: float,
    shares: float,
    net_debt: float,
    current_fcf: float,
    wacc: float,
    terminal_g: float,
) -> float | None:
    """
    Binary-search for the 10-year Stage-1 FCF growth rate implied by the
    current market price. Stage 2 fades that rate to terminal_g over years 6-10.
    """
    if current_fcf <= 0 or shares <= 0 or current_price <= 0:
        return None

    target_ev = current_price * shares + net_debt

    def ev_from_growth(g: float) -> float:
        fcf = current_fcf
        pv = 0.0
        for yr in range(1, 11):
            if yr <= 5:
                yr_g = g
            else:
                fade = (yr - 5) / 5
                yr_g = g * (1 - fade) + terminal_g * fade
            fcf *= 1 + yr_g
            pv += fcf / (1 + wacc) ** yr
        tv = fcf * (1 + terminal_g) / (wacc - terminal_g)
        return pv + tv / (1 + wacc) ** 10

    lo, hi = -0.50, 1.50
    for _ in range(64):
        mid = (lo + hi) / 2
        try:
            if ev_from_growth(mid) < target_ev:
                lo = mid
            else:
                hi = mid
        except Exception:
            break

    result = (lo + hi) / 2
    return float(result) if -0.5 < result < 1.5 else None


# ─── Monte Carlo ──────────────────────────────────────────────────────────────

def monte_carlo_dcf(dcf: dict, n: int = 1500) -> dict | None:
    """
    Vectorised Monte Carlo simulation over WACC, growth, and terminal growth.
    Returns percentile distribution of intrinsic values.
    """
    base_w  = dcf["wacc_data"]["wacc"]
    base_g  = dcf["growth_rates"]["blended"]
    base_tg = dcf["assumptions"].get("terminal_growth", 0.025)
    fcf0    = abs(dcf["current_fcf"])
    shares  = dcf["shares_outstanding"]
    nd      = dcf["net_debt"]

    if fcf0 <= 0 or shares <= 0:
        return None

    rng     = np.random.default_rng(42)
    waccs   = rng.normal(base_w,  0.015, n)
    growths = rng.normal(base_g,  0.07,  n)
    tgs     = rng.normal(base_tg, 0.005, n)

    tgs   = np.clip(tgs, 0.005, 0.04)
    growths = np.clip(growths, -0.30, 0.55)
    waccs = np.maximum(np.clip(waccs, 0.04, 0.25), tgs + 0.01)

    # Year-by-year growth matrix (n, 10)
    yr_arr = np.arange(1, 11)
    yr_g   = np.zeros((n, 10))
    yr_g[:, :5] = growths[:, np.newaxis]
    for i in range(5, 10):
        fade = (i - 4) / 5
        yr_g[:, i] = growths * (1 - fade) + tgs * fade

    # FCF matrix (n, 10): cumulative product of (1+g) applied to fcf0
    g_plus1 = 1 + yr_g
    cum_prod = np.cumprod(g_plus1, axis=1)
    fcf_mat  = fcf0 * cum_prod

    # Discount matrix
    disc = (1 / (1 + waccs[:, np.newaxis])) ** yr_arr[np.newaxis, :]

    pv    = (fcf_mat * disc).sum(axis=1)
    last_fcf = fcf_mat[:, 9]
    tv   = last_fcf * (1 + tgs) / (waccs - tgs)
    pv_tv = tv * disc[:, 9]

    iv = (pv + pv_tv - nd) / shares
    iv = iv[np.isfinite(iv) & (iv > -10_000) & (iv < 1_000_000)]

    if len(iv) < 100:
        return None

    return {
        "p10":  float(np.percentile(iv, 10)),
        "p25":  float(np.percentile(iv, 25)),
        "p50":  float(np.percentile(iv, 50)),
        "p75":  float(np.percentile(iv, 75)),
        "p90":  float(np.percentile(iv, 90)),
        "mean": float(np.mean(iv)),
        "std":  float(np.std(iv)),
        "n":    len(iv),
        "data": iv.tolist(),
    }


# ─── Sector multiples valuation ───────────────────────────────────────────────

def multiples_valuation(info: dict, net_debt: float) -> dict:
    """Cross-validate intrinsic value using sector-average P/E, EV/EBITDA, and P/S."""
    sector = info.get("sector", "Technology")
    mults  = SECTOR_MULTIPLES.get(sector, {"pe": 22, "ev_ebitda": 15, "ps": 3.0})
    shares = float(info.get("sharesOutstanding", 0) or 0)
    result = {"sector": sector, "multiples_used": mults}

    # P/E  (forward)
    fwd_eps = info.get("forwardEps")
    if fwd_eps and fwd_eps > 0 and mults.get("pe"):
        result["pe_value"]   = float(fwd_eps * mults["pe"])
        result["pe_multiple"] = mults["pe"]

    # EV / EBITDA
    ebitda = info.get("ebitda")
    if ebitda and ebitda > 0 and mults.get("ev_ebitda") and shares > 0:
        ev = float(ebitda) * mults["ev_ebitda"]
        result["ev_ebitda_value"]   = (ev - net_debt) / shares
        result["ev_ebitda_multiple"] = mults["ev_ebitda"]

    # P / S  (fallback for unprofitable companies)
    rev = info.get("totalRevenue")
    if rev and rev > 0 and mults.get("ps") and shares > 0:
        ev = float(rev) * mults["ps"]
        result["ps_value"]   = (ev - net_debt) / shares
        result["ps_multiple"] = mults["ps"]

    # Composite: weight available methods
    vals, weights = [], []
    if "pe_value" in result:
        vals.append(result["pe_value"]); weights.append(0.40)
    if "ev_ebitda_value" in result:
        vals.append(result["ev_ebitda_value"]); weights.append(0.35)
    if "ps_value" in result:
        vals.append(result["ps_value"]); weights.append(0.25)

    if vals:
        total_w = sum(weights)
        result["composite"] = sum(v * w for v, w in zip(vals, weights)) / total_w

    return result


# ─── Full DCF model ───────────────────────────────────────────────────────────

def run_dcf_model(stock_data: dict, assumptions: dict) -> dict:
    """Run the complete professional DCF analysis and return all results."""
    info = stock_data.get("info", {})
    warnings: list[str] = []

    # ── FCF ─────────────────────────────────────────────────────────────────
    # Prefer TTM (quarterly), fall back to annual
    ttm_fcf, ttm_src = get_ttm_fcf(stock_data)
    hist_fcf, hist_yrs, hist_src = extract_fcf_history(stock_data)

    if ttm_fcf is not None:
        current_fcf = ttm_fcf
        data_source = ttm_src
    else:
        current_fcf = hist_fcf[0] if hist_fcf else 0
        data_source = hist_src

    if not current_fcf or current_fcf <= 0:
        warnings.append(
            "Free cash flow is negative or unavailable — DCF is approximate for "
            "pre-profitability companies"
        )
    if data_source == "estimated":
        warnings.append("Limited financial data — FCF estimated from revenue × operating margin")
    elif data_source in ("operating_cf", "quarterly_op_only"):
        warnings.append("CapEx data unavailable — using operating cash flow as FCF proxy")

    # ── Growth rates ─────────────────────────────────────────────────────────
    growth = calculate_growth_rates(hist_fcf, info)

    # ── WACC ─────────────────────────────────────────────────────────────────
    wacc_data = calculate_wacc(stock_data, assumptions)
    wacc = wacc_data["wacc"]
    terminal_g = assumptions.get("terminal_growth", 0.025)

    if wacc <= terminal_g:
        wacc = terminal_g + 0.02
        wacc_data["wacc"] = wacc
        warnings.append("WACC adjusted to exceed terminal growth rate for model validity")

    # ── 3-Stage projection ───────────────────────────────────────────────────
    base_fcf = abs(current_fcf) if current_fcf else (abs(hist_fcf[0]) if hist_fcf else 1e8)
    proj_data = project_fcf_3stage(base_fcf, growth, assumptions)
    projected_fcf = proj_data["fcf"]

    # ── Discounting ──────────────────────────────────────────────────────────
    pv_fcf = [fcf / (1 + wacc) ** (i + 1) for i, fcf in enumerate(projected_fcf)]
    total_pv_fcf = sum(pv_fcf)

    # Terminal value (Gordon Growth from Year-10 FCF)
    terminal_value = projected_fcf[-1] * (1 + terminal_g) / (wacc - terminal_g)
    pv_terminal    = terminal_value / (1 + wacc) ** len(projected_fcf)
    enterprise_value = total_pv_fcf + pv_terminal

    # ── Bridge to equity ─────────────────────────────────────────────────────
    total_debt  = float(info.get("totalDebt",  0) or 0)
    total_cash  = float(info.get("totalCash",  0) or 0)
    net_debt    = total_debt - total_cash
    equity_value = enterprise_value - net_debt

    shares = float(info.get("sharesOutstanding", 0) or 0)
    if shares > 0:
        intrinsic_value = equity_value / shares
    else:
        intrinsic_value = 0
        warnings.append("Shares outstanding unavailable — per-share value cannot be computed")

    current_price = float(info.get("currentPrice") or info.get("regularMarketPrice") or 0)
    upside_pct    = ((intrinsic_value - current_price) / current_price * 100
                     if current_price > 0 and intrinsic_value > 0 else 0.0)
    margin_safety = ((intrinsic_value - current_price) / intrinsic_value * 100
                     if intrinsic_value > 0 else 0.0)
    pv_term_pct   = pv_terminal / enterprise_value * 100 if enterprise_value > 0 else 0

    dcf = {
        # Raw data
        "fcf_history": hist_fcf,
        "fcf_years":   hist_yrs,
        "current_fcf": current_fcf,
        "ttm_fcf":     ttm_fcf,
        "data_source": data_source,
        # Growth
        "growth_rates": growth,
        "projection":   proj_data,
        # WACC
        "wacc_data":   wacc_data,
        # Cash flows
        "projected_fcf":  projected_fcf,
        "pv_fcf":         pv_fcf,
        "total_pv_fcf":   total_pv_fcf,
        # Terminal
        "terminal_value": terminal_value,
        "pv_terminal":    pv_terminal,
        "pv_terminal_pct":pv_term_pct,
        # Valuation
        "enterprise_value":  enterprise_value,
        "net_debt":          net_debt,
        "equity_value":      equity_value,
        "shares_outstanding":shares,
        "intrinsic_value":   intrinsic_value,
        "current_price":     current_price,
        "upside_pct":        upside_pct,
        "margin_of_safety":  margin_safety,
        # Meta
        "warnings":    warnings,
        "assumptions": assumptions,
    }

    return dcf


# ─── Post-model enrichment (call separately to avoid slowing initial render) ──

def enrich_with_advanced(dcf: dict, stock_data: dict) -> dict:
    """Add reverse DCF, Monte Carlo, and multiples valuation to an existing result."""
    info    = stock_data.get("info", {})
    wacc    = dcf["wacc_data"]["wacc"]
    tg      = dcf["assumptions"].get("terminal_growth", 0.025)
    fcf0    = abs(dcf["current_fcf"]) if dcf["current_fcf"] else 0

    dcf["reverse_dcf_growth"] = reverse_dcf(
        dcf["current_price"], dcf["shares_outstanding"],
        dcf["net_debt"], fcf0, wacc, tg,
    )
    dcf["monte_carlo"] = monte_carlo_dcf(dcf)
    dcf["multiples"]   = multiples_valuation(info, dcf["net_debt"])
    return dcf


# ─── Sensitivity table ────────────────────────────────────────────────────────

def sensitivity_table(dcf: dict) -> pd.DataFrame:
    """
    2-D sensitivity: WACC ± 2% (rows) × terminal growth 1–4% (cols).
    Cell = intrinsic value per share.
    """
    base_w  = dcf["wacc_data"]["wacc"]
    tg_vals = [0.010, 0.015, 0.020, 0.025, 0.030, 0.035, 0.040]
    w_offs  = [-0.02, -0.01, 0.00, 0.01, 0.02]

    rows = {}
    for dw in w_offs:
        w = base_w + dw
        row = {}
        for tg in tg_vals:
            col = f"{tg*100:.1f}%"
            if w <= tg:
                row[col] = None
                continue
            pv = sum(f / (1 + w) ** (i + 1) for i, f in enumerate(dcf["projected_fcf"]))
            tv = dcf["projected_fcf"][-1] * (1 + tg) / (w - tg)
            ev = pv + tv / (1 + w) ** len(dcf["projected_fcf"])
            eq = ev - dcf["net_debt"]
            row[col] = round(eq / dcf["shares_outstanding"], 2) if dcf["shares_outstanding"] > 0 else None
        rows[f"WACC {w*100:.1f}%"] = row

    return pd.DataFrame(rows).T


# ─── Formatting helpers ───────────────────────────────────────────────────────

def fmt(n, prefix="", suffix="", decimals=2) -> str:
    if n is None:
        return "N/A"
    n = float(n)
    if abs(n) >= 1e12: return f"{prefix}{n/1e12:.{decimals}f}T{suffix}"
    if abs(n) >= 1e9:  return f"{prefix}{n/1e9:.{decimals}f}B{suffix}"
    if abs(n) >= 1e6:  return f"{prefix}{n/1e6:.{decimals}f}M{suffix}"
    if abs(n) >= 1e3:  return f"{prefix}{n/1e3:.{decimals}f}K{suffix}"
    return f"{prefix}{n:.{decimals}f}{suffix}"
