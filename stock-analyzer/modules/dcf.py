import pandas as pd
import numpy as np
from datetime import datetime


# ─── Data Extraction ──────────────────────────────────────────────────────────

def _find_row(df: pd.DataFrame, keys: list):
    """Find first matching row in a DataFrame by a list of possible key names."""
    for key in keys:
        if key in df.index:
            return df.loc[key].dropna()
    return None


def extract_fcf_history(stock_data: dict) -> tuple:
    """
    Return (fcf_list, years_list, source_label).
    fcf_list[0] is the most recent year (yfinance ordering).
    """
    cf = stock_data.get("cashflow", pd.DataFrame())
    info = stock_data.get("info", {})

    if cf is not None and not cf.empty:
        # Try direct FCF row
        fcf_series = _find_row(cf, ["Free Cash Flow", "FreeCashFlow"])
        if fcf_series is not None and len(fcf_series) > 0:
            return fcf_series.tolist(), [d.year for d in fcf_series.index], "direct"

        # Build from operating CF – capex
        op = _find_row(cf, ["Operating Cash Flow", "Total Cash From Operating Activities",
                             "Cash From Operating Activities"])
        cx = _find_row(cf, ["Capital Expenditure", "Capital Expenditures",
                             "Purchase Of Property Plant And Equipment"])
        if op is not None:
            if cx is not None:
                aligned = pd.concat([op, cx], axis=1).dropna()
                if not aligned.empty:
                    fcf = (aligned.iloc[:, 0] + aligned.iloc[:, 1]).tolist()
                    years = [d.year for d in aligned.index]
                    return fcf, years, "calculated"
            # Fall back to operating CF alone
            return op.tolist(), [d.year for d in op.index], "operating_cf"

    # Last resort: estimate from income statement
    revenue = info.get("totalRevenue", 0) or 0
    op_margin = info.get("operatingMargins", 0.10) or 0.10
    estimated = revenue * op_margin * 0.79  # rough after-tax FCF proxy
    return [estimated], [datetime.now().year], "estimated"


# ─── Growth Rate Analysis ─────────────────────────────────────────────────────

def calculate_growth_rates(fcf_history: list) -> dict:
    """Return CAGR, recent growth, and stability assessment."""
    valid = [v for v in fcf_history if v and v > 0]

    if len(valid) < 2:
        return {"cagr": 0.08, "recent_growth": 0.08, "stability": "low"}

    # yfinance: newest first
    newest, oldest = fcf_history[0], fcf_history[-1]
    n = len(fcf_history) - 1

    if oldest > 0 and newest > 0:
        cagr = (newest / oldest) ** (1 / n) - 1
        cagr = float(np.clip(cagr, -0.5, 1.0))
    else:
        cagr = 0.08

    if len(fcf_history) >= 2 and fcf_history[1] and fcf_history[1] != 0:
        recent = (fcf_history[0] - fcf_history[1]) / abs(fcf_history[1])
        recent = float(np.clip(recent, -0.5, 1.0))
    else:
        recent = cagr

    # Stability: coefficient of variation on most recent 3 years
    recent3 = [v for v in fcf_history[:3] if v]
    if len(recent3) >= 3 and all(v > 0 for v in recent3):
        cv = np.std(recent3) / abs(np.mean(recent3)) if np.mean(recent3) != 0 else 1
        stability = "high" if cv < 0.25 else ("medium" if cv < 0.55 else "low")
    elif len(recent3) >= 2 and all(v > 0 for v in recent3):
        stability = "medium"
    else:
        stability = "low"

    return {"cagr": cagr, "recent_growth": recent, "stability": stability}


# ─── FCF Projection ───────────────────────────────────────────────────────────

def project_fcf(current_fcf: float, growth_rates: dict, assumptions: dict) -> list:
    """Project FCF over N years, fading from base growth to terminal growth."""
    years = assumptions.get("projection_years", 5)
    terminal_g = assumptions.get("terminal_growth", 0.025)
    adjustment = assumptions.get("growth_adjustment", 0.0)

    base_g = float(
        np.clip(
            0.6 * growth_rates["cagr"] + 0.4 * growth_rates["recent_growth"] + adjustment,
            -0.20,
            0.45,
        )
    )

    projected = []
    for yr in range(1, years + 1):
        fade = (yr - 1) / max(years - 1, 1)
        yr_g = base_g * (1 - fade) + terminal_g * fade
        prev = projected[-1] if projected else current_fcf
        projected.append(prev * (1 + yr_g))

    return projected


# ─── WACC ─────────────────────────────────────────────────────────────────────

def calculate_wacc(stock_data: dict, assumptions: dict) -> dict:
    """Calculate Weighted Average Cost of Capital."""
    info = stock_data.get("info", {})
    rf = assumptions.get("risk_free_rate", 0.045)
    mrp = assumptions.get("market_risk_premium", 0.055)

    beta = info.get("beta") or 1.0
    if beta < 0:
        beta = 1.0
    cost_equity = rf + float(beta) * mrp

    mkt_cap = info.get("marketCap", 0) or 0
    total_debt = info.get("totalDebt", 0) or 0
    total_cap = mkt_cap + total_debt

    if total_cap == 0:
        return {
            "wacc": cost_equity, "cost_of_equity": cost_equity,
            "cost_of_debt": 0.05, "after_tax_cost_of_debt": 0.0395,
            "equity_weight": 1.0, "debt_weight": 0.0, "beta": beta,
        }

    eq_w = mkt_cap / total_cap
    dt_w = total_debt / total_cap

    # Estimate cost of debt
    cod = 0.05
    fin = stock_data.get("financials", pd.DataFrame())
    if fin is not None and not fin.empty and total_debt > 0:
        ie = _find_row(fin, ["Interest Expense", "Interest And Debt Expense"])
        if ie is not None and len(ie) > 0:
            raw = abs(float(ie.iloc[0]))
            if raw > 0:
                cod = float(np.clip(raw / total_debt, 0.02, 0.20))

    tax_rate = 0.21
    atcod = cod * (1 - tax_rate)
    wacc = eq_w * cost_equity + dt_w * atcod

    return {
        "wacc": wacc, "cost_of_equity": cost_equity,
        "cost_of_debt": cod, "after_tax_cost_of_debt": atcod,
        "equity_weight": eq_w, "debt_weight": dt_w, "beta": beta,
    }


# ─── Full DCF Model ───────────────────────────────────────────────────────────

def run_dcf_model(stock_data: dict, assumptions: dict) -> dict:
    """Run the complete DCF model and return all results."""
    info = stock_data.get("info", {})
    warnings = []

    # FCF history
    fcf_history, fcf_years, data_source = extract_fcf_history(stock_data)
    current_fcf = fcf_history[0] if fcf_history else 0

    if not current_fcf or current_fcf <= 0:
        warnings.append("Current free cash flow is negative — DCF is less reliable for this stage of business")

    if data_source == "estimated":
        warnings.append("Limited financial data available — using revenue-based FCF estimate")
    elif data_source == "operating_cf":
        warnings.append("CapEx data unavailable — using operating cash flow as FCF proxy")

    # Growth rates
    growth = calculate_growth_rates(fcf_history)

    # WACC
    wacc_data = calculate_wacc(stock_data, assumptions)
    wacc = wacc_data["wacc"]
    terminal_g = assumptions.get("terminal_growth", 0.025)

    if wacc <= terminal_g:
        wacc = terminal_g + 0.02
        warnings.append("WACC was below terminal growth rate — adjusted upward to maintain valid model")

    # Projected FCF
    projected_fcf = project_fcf(abs(current_fcf), growth, assumptions)

    # Discount projected FCF
    pv_fcf = [fcf / (1 + wacc) ** (i + 1) for i, fcf in enumerate(projected_fcf)]
    total_pv_fcf = sum(pv_fcf)

    # Terminal value (Gordon Growth)
    terminal_value = projected_fcf[-1] * (1 + terminal_g) / (wacc - terminal_g)
    pv_terminal = terminal_value / (1 + wacc) ** len(projected_fcf)

    enterprise_value = total_pv_fcf + pv_terminal

    # Equity value
    total_debt = info.get("totalDebt", 0) or 0
    total_cash = info.get("totalCash", 0) or 0
    net_debt = total_debt - total_cash
    equity_value = enterprise_value - net_debt

    shares = info.get("sharesOutstanding", 0) or 0
    if shares > 0:
        intrinsic_value = equity_value / shares
    else:
        intrinsic_value = 0
        warnings.append("Shares outstanding unavailable — cannot compute per-share value")

    current_price = info.get("currentPrice") or info.get("regularMarketPrice", 0) or 0

    upside_pct = 0.0
    margin_of_safety = 0.0
    if current_price > 0 and intrinsic_value > 0:
        upside_pct = (intrinsic_value - current_price) / current_price * 100
        margin_of_safety = (intrinsic_value - current_price) / intrinsic_value * 100

    return {
        "fcf_history": fcf_history,
        "fcf_years": fcf_years,
        "data_source": data_source,
        "current_fcf": current_fcf,
        "growth_rates": growth,
        "wacc_data": wacc_data,
        "projected_fcf": projected_fcf,
        "pv_fcf": pv_fcf,
        "total_pv_fcf": total_pv_fcf,
        "terminal_value": terminal_value,
        "pv_terminal": pv_terminal,
        "pv_terminal_pct": pv_terminal / enterprise_value * 100 if enterprise_value > 0 else 0,
        "enterprise_value": enterprise_value,
        "net_debt": net_debt,
        "equity_value": equity_value,
        "shares_outstanding": shares,
        "intrinsic_value": intrinsic_value,
        "current_price": current_price,
        "upside_pct": upside_pct,
        "margin_of_safety": margin_of_safety,
        "warnings": warnings,
        "assumptions": assumptions,
    }


# ─── Sensitivity Analysis ─────────────────────────────────────────────────────

def sensitivity_table(dcf: dict) -> pd.DataFrame:
    """
    2-D sensitivity of intrinsic value vs. WACC and terminal growth rate.
    Rows = WACC offsets, Cols = terminal growth rates.
    """
    base_wacc = dcf["wacc_data"]["wacc"]
    base_tg = dcf["assumptions"].get("terminal_growth", 0.025)
    assumptions = dict(dcf["assumptions"])

    wacc_offsets = [-0.02, -0.01, 0.0, 0.01, 0.02]
    tg_values = [0.010, 0.015, 0.020, 0.025, 0.030, 0.035]

    rows = {}
    for dw in wacc_offsets:
        w = base_wacc + dw
        row = {}
        for tg in tg_values:
            if w <= tg:
                row[f"{tg*100:.1f}%"] = None
            else:
                assumptions["terminal_growth"] = tg
                pv = sum(fcf / (1 + w) ** (i + 1) for i, fcf in enumerate(dcf["projected_fcf"]))
                tv = dcf["projected_fcf"][-1] * (1 + tg) / (w - tg)
                pv_tv = tv / (1 + w) ** len(dcf["projected_fcf"])
                ev = pv + pv_tv
                eq = ev - dcf["net_debt"]
                row[f"{tg*100:.1f}%"] = round(eq / dcf["shares_outstanding"], 2) if dcf["shares_outstanding"] > 0 else None
        rows[f"WACC {w*100:.1f}%"] = row

    return pd.DataFrame(rows).T


# ─── Formatting ──────────────────────────────────────────────────────────────

def fmt(n, prefix="", suffix="", decimals=2) -> str:
    """Format a large number with B/M/K suffix."""
    if n is None:
        return "N/A"
    n = float(n)
    if abs(n) >= 1e12:
        return f"{prefix}{n/1e12:.{decimals}f}T{suffix}"
    if abs(n) >= 1e9:
        return f"{prefix}{n/1e9:.{decimals}f}B{suffix}"
    if abs(n) >= 1e6:
        return f"{prefix}{n/1e6:.{decimals}f}M{suffix}"
    if abs(n) >= 1e3:
        return f"{prefix}{n/1e3:.{decimals}f}K{suffix}"
    return f"{prefix}{n:.{decimals}f}{suffix}"
