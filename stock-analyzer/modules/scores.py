"""
Financial scoring models: Piotroski F-Score, Altman Z-Score,
5-pillar Pentagon radar, historical financials extractor.
"""
from __future__ import annotations

import math
import numpy as np
import pandas as pd

from modules.dcf import SECTOR_MULTIPLES


# ─── DataFrame helper ─────────────────────────────────────────────────────────

def _row(df: pd.DataFrame | None, keys: list[str]) -> pd.Series | None:
    if df is None or df.empty:
        return None
    for k in keys:
        if k in df.index:
            s = df.loc[k].dropna()
            if len(s):
                return s
    return None


def _v(series: pd.Series | None, i: int = 0) -> float | None:
    if series is None or len(series) <= i:
        return None
    v = series.iloc[i]
    try:
        f = float(v)
        return None if (math.isnan(f) or math.isinf(f)) else f
    except (TypeError, ValueError):
        return None


# ─── Piotroski F-Score ────────────────────────────────────────────────────────

def piotroski_f_score(stock_data: dict) -> dict:
    """
    Piotroski F-Score (0-9).
    Profitability (4) + Leverage/Liquidity (3) + Operating Efficiency (2).
    """
    bs  = stock_data.get("balance_sheet",  pd.DataFrame())
    fin = stock_data.get("financials",     pd.DataFrame())
    cf  = stock_data.get("cashflow",       pd.DataFrame())
    info = stock_data.get("info", {})

    score = 0
    checks: list[tuple[str, bool | None, str]] = []

    # ── Extract key series ────────────────────────────────────────────────────
    ni_s  = _row(fin, ["Net Income", "NetIncome", "Net Income Common Stockholders"])
    ta_s  = _row(bs,  ["Total Assets", "TotalAssets"])
    ocf_s = _row(cf,  ["Operating Cash Flow", "Total Cash From Operating Activities",
                        "Cash From Operating Activities"])
    ltd_s = _row(bs,  ["Long Term Debt", "LongTermDebt", "Long-Term Debt",
                        "Long Term Debt And Capital Lease Obligation"])
    ca_s  = _row(bs,  ["Current Assets", "TotalCurrentAssets", "Total Current Assets"])
    cl_s  = _row(bs,  ["Current Liabilities", "TotalCurrentLiabilities",
                        "Total Current Liabilities"])
    sh_s  = _row(bs,  ["Ordinary Shares Number", "Share Issued",
                        "Common Stock", "CommonStock"])
    gp_s  = _row(fin, ["Gross Profit", "GrossProfit"])
    rev_s = _row(fin, ["Total Revenue", "TotalRevenue"])

    ni_0, ni_1   = _v(ni_s, 0),  _v(ni_s, 1)
    ta_0, ta_1   = _v(ta_s, 0),  _v(ta_s, 1)
    ocf_0        = _v(ocf_s, 0)
    ltd_0, ltd_1 = _v(ltd_s, 0), _v(ltd_s, 1)
    ca_0, ca_1   = _v(ca_s, 0),  _v(ca_s, 1)
    cl_0, cl_1   = _v(cl_s, 0),  _v(cl_s, 1)
    sh_0, sh_1   = _v(sh_s, 0),  _v(sh_s, 1)
    gp_0, gp_1   = _v(gp_s, 0),  _v(gp_s, 1)
    rev_0, rev_1 = _v(rev_s, 0), _v(rev_s, 1)

    def chk(name: str, passed: bool | None, detail: str):
        nonlocal score
        checks.append((name, passed, detail))
        if passed:
            score += 1

    # ── 1. Profitability: ROA > 0 ─────────────────────────────────────────────
    if ni_0 is not None and ta_0 and ta_0 > 0:
        roa0 = ni_0 / ta_0
        chk("ROA Positive", roa0 > 0, f"ROA = {roa0*100:.2f}%")
    else:
        chk("ROA Positive", None, "Insufficient data")

    # ── 2. Profitability: Operating Cash Flow > 0 ─────────────────────────────
    if ocf_0 is not None:
        chk("Positive Operating Cash Flow", ocf_0 > 0,
            f"OCF = ${ocf_0/1e9:.2f}B")
    else:
        chk("Positive Operating Cash Flow", None, "Insufficient data")

    # ── 3. Profitability: ΔROA > 0 ───────────────────────────────────────────
    if all(v is not None and v > 0 for v in [ta_0, ta_1]) and ni_0 is not None and ni_1 is not None:
        roa0 = ni_0 / ta_0
        roa1 = ni_1 / ta_1
        chk("Increasing ROA", roa0 > roa1,
            f"{roa0*100:.1f}% vs {roa1*100:.1f}% prior year")
    else:
        chk("Increasing ROA", None, "Insufficient history")

    # ── 4. Profitability: Earnings Quality (OCF > Net Income) ────────────────
    if ocf_0 is not None and ni_0 is not None:
        chk("Quality Earnings (OCF > Net Income)", ocf_0 > ni_0,
            f"OCF ${ocf_0/1e9:.2f}B > NI ${ni_0/1e9:.2f}B")
    else:
        chk("Quality Earnings (OCF > Net Income)", None, "Insufficient data")

    # ── 5. Leverage: Long-term debt ratio decreased ───────────────────────────
    if ta_0 and ta_0 > 0 and ta_1 and ta_1 > 0:
        lev0 = (ltd_0 or 0) / ta_0
        lev1 = (ltd_1 or 0) / ta_1
        chk("Decreasing Long-Term Leverage", lev0 <= lev1,
            f"Debt/Assets: {lev0*100:.1f}% vs {lev1*100:.1f}% prior year")
    else:
        chk("Decreasing Long-Term Leverage", None, "Insufficient data")

    # ── 6. Liquidity: Current Ratio improved ──────────────────────────────────
    if all(v is not None and v > 0 for v in [ca_0, cl_0, ca_1, cl_1]):
        cr0 = ca_0 / cl_0
        cr1 = ca_1 / cl_1
        chk("Improving Current Ratio", cr0 > cr1,
            f"{cr0:.2f}x vs {cr1:.2f}x prior year")
    elif info.get("currentRatio"):
        cr = info["currentRatio"]
        chk("Current Ratio > 1.5", cr > 1.5, f"Current ratio: {cr:.2f}x")
    else:
        chk("Improving Current Ratio", None, "Insufficient data")

    # ── 7. Dilution: No new shares issued ────────────────────────────────────
    if sh_0 is not None and sh_1 is not None and sh_1 > 0:
        chg = (sh_0 - sh_1) / sh_1 * 100
        chk("No Share Dilution", sh_0 <= sh_1 * 1.01, f"Share count change: {chg:+.1f}%")
    else:
        chk("No Share Dilution", None, "Insufficient data")

    # ── 8. Efficiency: Gross Margin improved ─────────────────────────────────
    if all(v is not None and v > 0 for v in [gp_0, gp_1, rev_0, rev_1]):
        gm0 = gp_0 / rev_0
        gm1 = gp_1 / rev_1
        chk("Improving Gross Margin", gm0 > gm1,
            f"{gm0*100:.1f}% vs {gm1*100:.1f}% prior year")
    else:
        chk("Improving Gross Margin", None, "Insufficient data")

    # ── 9. Efficiency: Asset Turnover improved ────────────────────────────────
    if all(v is not None and v > 0 for v in [rev_0, rev_1, ta_0, ta_1]):
        at0 = rev_0 / ta_0
        at1 = rev_1 / ta_1
        chk("Improving Asset Turnover", at0 > at1,
            f"{at0:.2f}x vs {at1:.2f}x prior year")
    else:
        chk("Improving Asset Turnover", None, "Insufficient data")

    if   score >= 7: grade, color = "Strong",   "#10b981"
    elif score >= 4: grade, color = "Neutral",  "#f59e0b"
    else:            grade, color = "Weak",     "#ef4444"

    return {
        "score": score, "max": 9,
        "grade": grade, "color": color,
        "checks": checks,
    }


# ─── Altman Z-Score ───────────────────────────────────────────────────────────

def altman_z_score(stock_data: dict) -> dict:
    """
    Classic Altman Z-Score for publicly-listed non-financial companies.
    Z > 2.99 = Safe  |  1.81-2.99 = Grey  |  < 1.81 = Distress
    """
    bs   = stock_data.get("balance_sheet",  pd.DataFrame())
    fin  = stock_data.get("financials",     pd.DataFrame())
    info = stock_data.get("info", {})

    ta_s  = _row(bs,  ["Total Assets", "TotalAssets"])
    ca_s  = _row(bs,  ["Current Assets",      "TotalCurrentAssets"])
    cl_s  = _row(bs,  ["Current Liabilities", "TotalCurrentLiabilities"])
    re_s  = _row(bs,  ["Retained Earnings", "RetainedEarnings",
                        "Retained Earnings Equity"])
    tl_s  = _row(bs,  ["Total Liabilities Net Minority Interest",
                        "Total Liab", "TotalLiabilitiesNetMinorityInterest"])
    rev_s = _row(fin, ["Total Revenue", "TotalRevenue"])
    ebit_s = _row(fin, ["EBIT", "Operating Income", "OperatingIncome"])

    ta   = _v(ta_s,  0)
    ca   = _v(ca_s,  0)
    cl   = _v(cl_s,  0)
    re   = _v(re_s,  0)
    tl   = _v(tl_s,  0)
    rev  = _v(rev_s, 0)
    ebit = _v(ebit_s,0)
    mc   = info.get("marketCap")

    if not (ta and ta > 0 and mc):
        return {"score": None, "zone": "Unavailable", "color": "#94a3b8",
                "x1": None, "x2": None, "x3": None, "x4": None, "x5": None}

    x1 = ((ca or 0) - (cl or 0)) / ta          # Working Capital / Total Assets
    x2 = (re or 0) / ta                          # Retained Earnings / Total Assets
    x3 = (ebit or 0) / ta                        # EBIT / Total Assets
    x4 = mc / (tl or 1)                          # Market Cap / Total Liabilities
    x5 = (rev or 0) / ta                         # Revenue / Total Assets

    z = 1.2*x1 + 1.4*x2 + 3.3*x3 + 0.6*x4 + 1.0*x5

    if   z > 2.99: zone, color = "Safe Zone",     "#10b981"
    elif z > 1.81: zone, color = "Grey Zone",     "#f59e0b"
    else:          zone, color = "Distress Zone", "#ef4444"

    return {
        "score": round(z, 2), "zone": zone, "color": color,
        "x1": round(x1, 3), "x2": round(x2, 3),
        "x3": round(x3, 3), "x4": round(x4, 3), "x5": round(x5, 3),
    }


# ─── Pentagon Radar Chart ─────────────────────────────────────────────────────

def calculate_pentagon(stock_data: dict, dcf: dict, key_metrics: dict) -> dict:
    """
    5-pillar scoring (0-6 each) for radar chart.
    Pillars: Value, Growth, Quality, Momentum, Income.
    """
    info  = stock_data.get("info", {})
    hist  = stock_data.get("history_1y",  pd.DataFrame())
    hist2 = stock_data.get("history_2y",  pd.DataFrame())

    sector   = key_metrics.get("sector", "Technology")
    sm       = SECTOR_MULTIPLES.get(sector, SECTOR_MULTIPLES["Technology"])
    cp       = key_metrics.get("current_price") or 0
    iv       = dcf.get("intrinsic_value")
    upside   = dcf.get("upside_pct", 0) or 0

    # ── 1. Value (0–6) ────────────────────────────────────────────────────────
    val = 0.0
    pe  = key_metrics.get("pe_ratio")
    eveb = key_metrics.get("ev_ebitda")
    ps  = key_metrics.get("ps_ratio")
    pb  = key_metrics.get("pb_ratio")
    tgt = key_metrics.get("target_price")

    if upside > 0:   val += 1.0
    if upside > 20:  val += 1.0
    if pe  and sm["pe"]   and pe  < sm["pe"]:   val += 1.0
    if eveb and sm.get("ev_ebitda") and eveb < sm["ev_ebitda"]: val += 1.0
    if ps  and sm["ps"]   and ps  < sm["ps"]:   val += 1.0
    if tgt and cp and tgt > cp:                  val += 1.0

    # ── 2. Growth (0–6) ───────────────────────────────────────────────────────
    grw = 0.0
    rev_g  = info.get("revenueGrowth")  or 0
    earn_g = info.get("earningsGrowth") or 0
    ag     = dcf.get("growth_rates", {}).get("analyst_growth")
    cagr   = dcf.get("growth_rates", {}).get("cagr", 0) or 0

    if rev_g  > 0.05:  grw += 1.0
    if rev_g  > 0.15:  grw += 1.0
    if earn_g > 0.05:  grw += 1.0
    if earn_g > 0.20:  grw += 1.0
    if cagr   > 0.08:  grw += 1.0
    if ag is not None and ag > 0.05: grw += 1.0

    # ── 3. Quality (0–6) ──────────────────────────────────────────────────────
    qlt = 0.0
    roe  = key_metrics.get("roe") or 0
    roa  = key_metrics.get("roa") or 0
    fcf  = dcf.get("current_fcf", 0) or 0
    ni   = 0.0
    fin_df = stock_data.get("financials", pd.DataFrame())
    ni_s = _row(fin_df, ["Net Income", "NetIncome"])
    if ni_s is not None: ni = _v(ni_s, 0) or 0
    op_m  = key_metrics.get("operating_margin") or 0
    piots = piotroski_f_score(stock_data).get("score", 0)

    if roe > 0.10:         qlt += 1.0
    if roe > 0.20:         qlt += 1.0
    if op_m > 0:           qlt += 1.0
    if fcf > 0:            qlt += 1.0
    if fcf > 0 and fcf > ni: qlt += 1.0
    if piots >= 6:         qlt += 1.0

    # ── 4. Momentum (0–6) ─────────────────────────────────────────────────────
    mom = 0.0
    if not hist.empty and len(hist) >= 2:
        cl = hist["Close"]
        c_now = float(cl.iloc[-1])
        try:
            r1m = (c_now - float(cl.iloc[-22])) / float(cl.iloc[-22])
            if r1m > 0: mom += 1.0
        except Exception: pass
        try:
            r3m = (c_now - float(cl.iloc[-63])) / float(cl.iloc[-63])
            if r3m > 0: mom += 1.0
        except Exception: pass
        try:
            r6m = (c_now - float(cl.iloc[-126])) / float(cl.iloc[-126])
            if r6m > 0: mom += 1.0
        except Exception: pass
        try:
            r12m = (c_now - float(cl.iloc[0])) / float(cl.iloc[0])
            if r12m > 0: mom += 1.0
        except Exception: pass
        # Above 50-day MA
        ma50 = float(cl.rolling(50).mean().iloc[-1]) if len(cl) >= 50 else None
        if ma50 and c_now > ma50: mom += 1.0
        # Above 200-day MA
        ma200 = float(cl.rolling(200).mean().iloc[-1]) if len(cl) >= 200 else None
        if ma200 and c_now > ma200: mom += 1.0

    # ── 5. Income (0–6) ───────────────────────────────────────────────────────
    inc = 0.0
    div_y = key_metrics.get("dividend_yield") or 0
    payout = info.get("payoutRatio") or 0
    total_cash = key_metrics.get("total_cash", 0) or 0
    total_debt = key_metrics.get("total_debt", 0) or 0
    mc = info.get("marketCap") or 0
    # Buyback yield approximation
    shares_now = info.get("sharesOutstanding") or 0
    repurchased = info.get("repurchaseOfStock") or 0
    buyback_y = abs(repurchased) / mc if mc > 0 and repurchased else 0

    if div_y > 0 or buyback_y > 0.005:  inc += 1.0
    if div_y > 0.01 or buyback_y > 0.01: inc += 1.0
    if div_y > 0.025:                    inc += 1.0
    if payout > 0 and payout < 0.70:    inc += 1.0
    if total_cash > total_debt:          inc += 1.0
    if (key_metrics.get("debt_to_equity") or 99) < 1.0: inc += 1.0

    # Cap each at 6
    val = min(round(val, 1), 6.0)
    grw = min(round(grw, 1), 6.0)
    qlt = min(round(qlt, 1), 6.0)
    mom = min(round(mom, 1), 6.0)
    inc = min(round(inc, 1), 6.0)

    composite = round((val + grw + qlt + mom + inc) / 30 * 100, 0)  # 0-100 composite

    return {
        "value":    val,
        "growth":   grw,
        "quality":  qlt,
        "momentum": mom,
        "income":   inc,
        "composite": composite,
    }


# ─── Historical Financials ────────────────────────────────────────────────────

def historical_financials(stock_data: dict) -> dict:
    """Extract 5-year annual Revenue, FCF, Net Income for trend charts."""
    fin = stock_data.get("financials", pd.DataFrame())
    cf  = stock_data.get("cashflow",   pd.DataFrame())

    out = {"years": [], "revenue": [], "net_income": [], "fcf": [], "gross_profit": []}

    if fin is None or fin.empty:
        return out

    # Identify years from financials columns
    years = [c.year if hasattr(c, "year") else int(str(c)[:4]) for c in fin.columns]
    out["years"] = years[:5]  # newest first

    rev_s = _row(fin, ["Total Revenue", "TotalRevenue"])
    ni_s  = _row(fin, ["Net Income", "NetIncome", "Net Income Common Stockholders"])
    gp_s  = _row(fin, ["Gross Profit", "GrossProfit"])
    ocf_s = _row(cf,  ["Operating Cash Flow", "Total Cash From Operating Activities"])
    cx_s  = _row(cf,  ["Capital Expenditure", "Capital Expenditures",
                        "Purchase Of Property Plant And Equipment"])

    for i in range(min(5, len(years))):
        out["revenue"].append(      (_v(rev_s, i) or 0) / 1e9)
        out["net_income"].append(   (_v(ni_s,  i) or 0) / 1e9)
        out["gross_profit"].append( (_v(gp_s,  i) or 0) / 1e9)

        ocf = _v(ocf_s, i)
        cx  = _v(cx_s,  i)
        if ocf is not None:
            fcf = ocf + (cx or 0)  # CapEx is negative in yfinance
        else:
            fcf = 0.0
        out["fcf"].append(round(fcf / 1e9, 2))

    # Round to 2dp
    for k in ("revenue", "net_income", "gross_profit"):
        out[k] = [round(v, 2) for v in out[k]]

    return out


# ─── Financial Health Score ───────────────────────────────────────────────────

def financial_health_score(stock_data: dict, dcf: dict, key_metrics: dict) -> dict:
    """
    Comprehensive financial health for both new and professional investors.
    Covers: Solvency, Liquidity, Capital Efficiency, Risk Profile.
    Returns grade (A–D), risk level (Low/Medium/High), and detailed checks.
    """
    info  = stock_data.get("info", {})
    bs    = stock_data.get("balance_sheet", pd.DataFrame())

    checks: list[tuple[str, str, str]] = []  # (icon, label, detail)
    raw_score = 0.0

    # ── Solvency: Interest Coverage ───────────────────────────────────────────
    ic = key_metrics.get("interest_coverage")
    if ic is not None:
        if ic > 10:
            raw_score += 2.0
            checks.append(("positive", "Strong interest coverage",
                            f"{ic:.1f}x — earnings comfortably cover interest payments"))
        elif ic > 5:
            raw_score += 1.5
            checks.append(("positive", "Healthy interest coverage",
                            f"{ic:.1f}x — debt servicing is manageable"))
        elif ic > 2:
            raw_score += 0.5
            checks.append(("neutral", "Adequate interest coverage",
                            f"{ic:.1f}x — watch if earnings decline"))
        else:
            checks.append(("negative", "Low interest coverage",
                            f"{ic:.1f}x — high debt-servicing risk"))
    else:
        total_debt = key_metrics.get("total_debt", 0) or 0
        if total_debt < 1e8:
            raw_score += 1.0
            checks.append(("positive", "Minimal long-term debt",
                            "Interest coverage not calculable but debt level is low"))
        else:
            checks.append(("neutral", "Interest coverage unavailable",
                            "Insufficient interest-expense data; assess debt manually"))

    # ── Solvency: Net Debt / EBITDA ──────────────────────────────────────────
    nd_ebitda = key_metrics.get("net_debt_ebitda")
    if nd_ebitda is not None:
        if nd_ebitda < 0:
            raw_score += 2.0
            checks.append(("positive", "Net cash position",
                            f"Cash exceeds total debt — fortress balance sheet"))
        elif nd_ebitda < 1.5:
            raw_score += 2.0
            checks.append(("positive", "Low financial leverage",
                            f"{nd_ebitda:.1f}× Net Debt/EBITDA — debt paid off in under 1.5 years of earnings"))
        elif nd_ebitda < 3.0:
            raw_score += 1.0
            checks.append(("neutral", "Moderate leverage",
                            f"{nd_ebitda:.1f}× Net Debt/EBITDA — acceptable for stable earnings"))
        else:
            checks.append(("negative", "High leverage",
                            f"{nd_ebitda:.1f}× Net Debt/EBITDA — refinancing risk if earnings fall"))
    else:
        total_cash = key_metrics.get("total_cash", 0) or 0
        total_debt = key_metrics.get("total_debt", 0) or 0
        if total_cash > total_debt:
            raw_score += 1.5
            checks.append(("positive", "Net cash position",
                            f"Cash ${total_cash/1e9:.1f}B > Debt ${total_debt/1e9:.1f}B"))

    # ── Liquidity: Current Ratio ──────────────────────────────────────────────
    cr = key_metrics.get("current_ratio")
    if cr is not None:
        if cr > 2:
            raw_score += 1.5
            checks.append(("positive", "Strong liquidity",
                            f"Current ratio {cr:.2f}× — ample short-term assets to cover liabilities"))
        elif cr > 1.5:
            raw_score += 1.0
            checks.append(("positive", "Healthy liquidity",
                            f"Current ratio {cr:.2f}×"))
        elif cr > 1:
            raw_score += 0.5
            checks.append(("neutral", "Adequate liquidity",
                            f"Current ratio {cr:.2f}× — acceptable but monitor working capital"))
        else:
            checks.append(("negative", "Tight liquidity",
                            f"Current ratio {cr:.2f}× — current liabilities exceed current assets"))

    # ── Liquidity: Quick Ratio (computed from balance sheet) ─────────────────
    ca_s  = _row(bs, ["Current Assets",      "TotalCurrentAssets"])
    cl_s  = _row(bs, ["Current Liabilities", "TotalCurrentLiabilities"])
    inv_s = _row(bs, ["Inventory", "Inventories"])
    ca_v  = _v(ca_s, 0);  cl_v = _v(cl_s, 0);  inv_v = _v(inv_s, 0) or 0.0
    quick_ratio = None
    if ca_v and cl_v and cl_v > 0:
        quick_ratio = (ca_v - inv_v) / cl_v
        if quick_ratio > 1:
            raw_score += 1.0
            checks.append(("positive", "Good quick ratio",
                            f"{quick_ratio:.2f}× — liquid assets cover short-term obligations without inventory"))
        elif quick_ratio > 0.8:
            checks.append(("neutral", "Borderline quick ratio",
                            f"{quick_ratio:.2f}× — okay for inventory-light businesses"))
        else:
            checks.append(("negative", "Weak quick ratio",
                            f"{quick_ratio:.2f}× — may struggle to meet immediate obligations"))

    # ── Capital Efficiency: ROIC ──────────────────────────────────────────────
    ebit        = key_metrics.get("ebit")
    total_debt  = key_metrics.get("total_debt", 0) or 0
    total_cash  = key_metrics.get("total_cash", 0) or 0
    total_equity = key_metrics.get("total_equity")
    roic = None

    if ebit and total_equity:
        # Use a sensible effective tax rate: try from income statement, fallback 21%
        ni_s  = _row(stock_data.get("financials", pd.DataFrame()),
                     ["Net Income", "NetIncome", "Net Income Common Stockholders"])
        tax_s = _row(stock_data.get("financials", pd.DataFrame()),
                     ["Income Tax Expense", "Tax Provision"])
        ni_v  = _v(ni_s, 0)
        tax_v = _v(tax_s, 0)
        pre_s = _row(stock_data.get("financials", pd.DataFrame()),
                     ["Pretax Income", "Income Before Tax"])
        pre_v = _v(pre_s, 0)
        if pre_v and pre_v != 0 and tax_v:
            eff_tax = max(0.0, min(0.40, tax_v / abs(pre_v)))
        else:
            eff_tax = 0.21

        nopat = ebit * (1.0 - eff_tax)
        invested_capital = (total_equity or 0) + total_debt - total_cash
        if invested_capital > 1e6:
            roic = nopat / invested_capital
            wacc = dcf.get("wacc_data", {}).get("wacc", 0.08) or 0.08
            spread = roic - wacc
            if spread > 0.08:
                raw_score += 2.0
                checks.append(("positive", "Exceptional ROIC vs WACC",
                                f"ROIC {roic*100:.1f}% vs WACC {wacc*100:.1f}% — high economic value creation"))
            elif spread > 0.03:
                raw_score += 1.5
                checks.append(("positive", "ROIC exceeds WACC",
                                f"ROIC {roic*100:.1f}% vs WACC {wacc*100:.1f}% — creating shareholder value"))
            elif spread > 0:
                raw_score += 0.5
                checks.append(("neutral", "ROIC slightly above WACC",
                                f"ROIC {roic*100:.1f}% vs WACC {wacc*100:.1f}% — marginal value creation"))
            else:
                checks.append(("negative", "ROIC below WACC",
                                f"ROIC {roic*100:.1f}% vs WACC {wacc*100:.1f}% — destroying economic value"))

    # ── Capital Efficiency: FCF Yield ─────────────────────────────────────────
    fcf = dcf.get("current_fcf", 0) or 0
    mc  = info.get("marketCap", 0) or 0
    fcf_yield = (fcf / mc) if (mc > 0) else None

    if fcf_yield is not None:
        if fcf_yield > 0.07:
            raw_score += 1.5
            checks.append(("positive", "High FCF yield",
                            f"{fcf_yield*100:.1f}% — excellent cash generation relative to price"))
        elif fcf_yield > 0.04:
            raw_score += 1.0
            checks.append(("positive", "Solid FCF yield",
                            f"{fcf_yield*100:.1f}%"))
        elif fcf_yield > 0.01:
            raw_score += 0.5
            checks.append(("neutral", "Modest FCF yield",
                            f"{fcf_yield*100:.1f}%"))
        elif fcf_yield <= 0:
            checks.append(("negative", "Negative FCF yield",
                            f"Company is burning cash — model reliability limited for DCF"))

    # ── Risk Badge (Low / Medium / High) ──────────────────────────────────────
    risk_pts = 0
    beta = key_metrics.get("beta", 1.0) or 1.0
    if beta > 2.0:    risk_pts += 3
    elif beta > 1.5:  risk_pts += 2
    elif beta > 1.2:  risk_pts += 1

    if nd_ebitda is not None:
        if nd_ebitda > 4:   risk_pts += 3
        elif nd_ebitda > 2: risk_pts += 1

    if ic is not None:
        if ic < 2:  risk_pts += 3
        elif ic < 5: risk_pts += 1

    # Check Altman Z for distress signal (reuse existing function)
    z_res = altman_z_score(stock_data)
    z_val = z_res.get("score")
    if z_val is not None:
        if z_val < 1.81:  risk_pts += 3
        elif z_val < 2.99: risk_pts += 1

    if   risk_pts >= 5: risk_level, risk_color = "High Risk",   "#fb7185"
    elif risk_pts >= 2: risk_level, risk_color = "Medium Risk", "#fbbf24"
    else:               risk_level, risk_color = "Low Risk",    "#34d399"

    # Final health score (0–10 scale)
    health_score = min(10, round(raw_score))
    if   health_score >= 8: grade, color = "A", "#34d399"
    elif health_score >= 6: grade, color = "B", "#22d3ee"
    elif health_score >= 4: grade, color = "C", "#fbbf24"
    else:                   grade, color = "D", "#fb7185"

    return {
        "score":        health_score,
        "grade":        grade,
        "color":        color,
        "risk_level":   risk_level,
        "risk_color":   risk_color,
        "risk_pts":     risk_pts,
        "roic":         roic,
        "fcf_yield":    fcf_yield,
        "interest_coverage": ic,
        "net_debt_ebitda":   nd_ebitda,
        "current_ratio":     cr,
        "quick_ratio":       quick_ratio,
        "checks":       checks,
    }


# ─── StockRank (composite badge) ─────────────────────────────────────────────

def stock_rank(pentagon: dict) -> dict:
    """Simple StockRank: Value + Growth + Quality composite, styled like Stockopedia."""
    v = pentagon.get("value",   0)
    g = pentagon.get("growth",  0)
    q = pentagon.get("quality", 0)

    rank = round((v + g + q) / 18 * 100)  # 0-100

    if   rank >= 75: grade, color = "A",  "#10b981"
    elif rank >= 55: grade, color = "B",  "#3b82f6"
    elif rank >= 35: grade, color = "C",  "#f59e0b"
    else:            grade, color = "D",  "#ef4444"

    return {"rank": rank, "grade": grade, "color": color}
