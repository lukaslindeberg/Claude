"""
Risk engine — market vs company-specific risk, bond- and equity-implied credit
risk, and an adjusted-EBITDA bridge.

Pure computation on data that has already been fetched (see market_data.py),
so everything here runs offline and is easy to test.
"""
from __future__ import annotations

import math
from datetime import date

import numpy as np
import pandas as pd

RECOVERY_RATE  = 0.40   # market convention for senior unsecured bonds
CREDIT_HORIZON = 5.0    # years — the standard CDS / "5-year default risk" tenor

RATING_BUCKETS = ["AAA", "AA", "A", "BBB", "BB", "B", "CCC"]

# Share of companies with each rating that actually defaulted within 5 years —
# rounded long-run averages from rating-agency default studies. Spreads price in
# far more than this (the "credit spread puzzle"): investors also charge for
# liquidity and for bearing default risk, so market-implied odds run higher.
HISTORICAL_PD_5Y = {"AAA": 0.003, "AA": 0.0035, "A": 0.0055, "BBB": 0.016,
                    "BB": 0.06, "B": 0.14, "CCC": 0.44}

# Damodaran-style synthetic ratings: interest coverage (EBIT / interest) → rating.
# Smaller firms need more coverage to earn the same rating.
_COVERAGE_LARGE = [(8.5, "AAA"), (6.5, "AA"), (5.5, "A+"), (4.25, "A"), (3.0, "A-"),
                   (2.5, "BBB"), (2.25, "BB+"), (2.0, "BB"), (1.75, "B+"), (1.5, "B"),
                   (1.25, "B-"), (0.8, "CCC"), (0.65, "CC"), (0.2, "C")]
_COVERAGE_SMALL = [(12.5, "AAA"), (9.5, "AA"), (7.5, "A+"), (6.0, "A"), (4.5, "A-"),
                   (4.0, "BBB"), (3.5, "BB+"), (3.0, "BB"), (2.5, "B+"), (2.0, "B"),
                   (1.5, "B-"), (1.25, "CCC"), (0.8, "CC"), (0.5, "C")]


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _ncdf(x: float) -> float:
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def _by_year(df: pd.DataFrame | None, keys: list[str]) -> dict[int, float]:
    """First matching statement row as {fiscal year: value}."""
    if df is None or getattr(df, "empty", True):
        return {}
    for k in keys:
        if k in df.index:
            row = df.loc[k]
            if isinstance(row, pd.DataFrame):
                row = row.iloc[0]
            out = {}
            for col, v in row.items():
                if pd.notna(v):
                    try:
                        out[pd.Timestamp(col).year] = float(v)
                    except Exception:
                        pass
            if out:
                return out
    return {}


def _latest(df: pd.DataFrame | None, keys: list[str]) -> float | None:
    vals = _by_year(df, keys)
    return vals[max(vals)] if vals else None


def _clean_prices(px: pd.Series | None) -> pd.Series:
    """Positive closes on a tz-naive daily index, so different feeds align."""
    if px is None or len(px) == 0:
        return pd.Series(dtype=float)
    s = pd.to_numeric(px, errors="coerce").dropna()
    s = s[s > 0]
    idx = pd.to_datetime(s.index)
    if getattr(idx, "tz", None) is not None:
        idx = idx.tz_convert(None)
    s.index = idx.normalize()
    return s[~s.index.duplicated(keep="last")].sort_index()


def _weekly_log_returns(px: pd.Series | None) -> pd.Series:
    s = _clean_prices(px)
    if s.empty:
        return s
    return np.log(s.resample("W-FRI").last().dropna()).diff().dropna()


def _ols(y: np.ndarray, x: np.ndarray) -> tuple[float, float]:
    """Slope and intercept of y on x."""
    xc = x - x.mean()
    denom = float(xc @ xc)
    if denom == 0:
        return 0.0, float(y.mean())
    b = float(xc @ (y - y.mean())) / denom
    return b, float(y.mean() - b * x.mean())


def interp_curve(curve: dict[float, float], t: float) -> float | None:
    """Linearly interpolated yield at maturity t (flat beyond the ends)."""
    if not curve:
        return None
    xs = sorted(curve)
    return float(np.interp(t, xs, [curve[x] for x in xs]))


# ─── Market vs company-specific risk ─────────────────────────────────────────

def risk_decomposition(stock_px: pd.Series | None, market_px: pd.Series | None,
                       industry_px: pd.Series | None = None,
                       min_weeks: int = 26) -> dict | None:
    """Split the variance of weekly returns into market, industry and company parts.

    The industry ETF's return is first stripped of its market component, so the
    two factors are orthogonal and the three shares add up to exactly 100%.
    Weekly returns avoid the non-synchronous-trading bias of daily data.
    """
    cols = {"stock": _weekly_log_returns(stock_px),
            "market": _weekly_log_returns(market_px)}
    has_ind = industry_px is not None and len(industry_px) > 0
    if has_ind:
        cols["industry"] = _weekly_log_returns(industry_px)
    df = pd.concat(cols, axis=1, join="inner").dropna()
    if len(df) < min_weeks:
        return None

    y = df["stock"].to_numpy()
    m = df["market"].to_numpy()
    var_y = float(y.var(ddof=1))
    if var_y <= 0:
        return None

    beta_m, a_m = _ols(y, m)
    resid = y - a_m - beta_m * m
    market_var = beta_m ** 2 * float(m.var(ddof=1))

    industry_var, beta_i = 0.0, None
    if has_ind:
        i = df["industry"].to_numpy()
        b_im, a_im = _ols(i, m)
        i_own = i - a_im - b_im * m          # the industry's move net of the market
        if i_own.var(ddof=1) > 0:
            beta_i, a_i = _ols(resid, i_own)
            industry_var = beta_i ** 2 * float(i_own.var(ddof=1))
            resid = resid - a_i - beta_i * i_own

    company_var = float(resid.var(ddof=1))
    total = market_var + industry_var + company_var
    return {
        "market_share":   market_var / total,
        "industry_share": industry_var / total,
        "company_share":  company_var / total,
        "beta":           beta_m,
        "industry_beta":  beta_i,
        "total_vol":      math.sqrt(var_y * 52),
        "company_vol":    math.sqrt(company_var * 52),
        "weeks":          len(df),
        "has_industry":   has_ind and beta_i is not None,
    }


def annual_volatility(px: pd.Series | None, window: int = 252) -> float | None:
    s = _clean_prices(px).iloc[-(window + 1):]
    r = np.log(s).diff().dropna()
    return float(r.std(ddof=1) * math.sqrt(252)) if len(r) >= 40 else None


def downside_metrics(px: pd.Series | None, window: int = 252) -> dict | None:
    """One-year realised downside: volatility, historical VaR/CVaR, drawdown."""
    s = _clean_prices(px).iloc[-(window + 1):]
    r = np.log(s).diff().dropna()
    if len(r) < 60:
        return None
    q5 = float(np.percentile(r, 5))
    return {
        "ann_vol":      float(r.std(ddof=1) * math.sqrt(252)),
        "var_95":       1 - math.exp(q5),                        # 1-day loss, 95%
        "cvar_95":      1 - math.exp(float(r[r <= q5].mean())),  # avg loss beyond VaR
        "max_drawdown": float((s / s.cummax() - 1).min()),
        "worst_day":    1 - math.exp(float(r.min())),
    }


# ─── Credit: spreads, ratings and default probabilities ──────────────────────

def spread_to_default(spread: float, recovery: float = RECOVERY_RATE) -> dict:
    """Credit triangle: a spread s pays for expected loss, so the implied
    (risk-neutral) default intensity is λ = s / (1 − R) and the cumulative
    default probability over T years is 1 − e^(−λT)."""
    s = max(float(spread), 0.0)
    lam = s / (1.0 - recovery)
    return {"spread": s, "hazard": lam,
            "pd_1y": 1 - math.exp(-lam),
            "pd_5y": 1 - math.exp(-lam * CREDIT_HORIZON)}


def synthetic_rating(coverage: float | None, market_cap: float | None) -> str | None:
    if coverage is None or not math.isfinite(coverage):
        return None
    table = _COVERAGE_LARGE if (market_cap or 0) >= 5e9 else _COVERAGE_SMALL
    for floor, rating in table:
        if coverage > floor:
            return rating
    return "D"


def rating_bucket(rating: str) -> str:
    """Map a notched rating (A-, BB+ …) onto the spread series it trades with."""
    r = rating.rstrip("+-")
    return r if r in RATING_BUCKETS else "CCC"


def rating_from_spread(spread: float | None, oas: dict[str, float]) -> str | None:
    """Nearest rating bucket, measured in log space (spreads step up geometrically)."""
    pts = {b: s for b, s in oas.items() if s and s > 0}
    if spread is None or not pts:
        return None
    s = max(spread, 1e-4)
    return min(pts, key=lambda b: abs(math.log(s / pts[b])))


def bond_ytm(price: float, coupon: float, years: float, freq: int = 2,
             face: float = 100.0) -> float | None:
    """Yield to maturity from a quoted (clean) price, solved by bisection.

    `coupon` is the annual rate as a decimal. Accrued interest is added to the
    clean quote, so the result matches what a bond screen shows.
    """
    if not (price and price > 0 and years and years > 0 and coupon is not None and coupon >= 0):
        return None
    n = max(1, math.ceil(years * freq - 1e-9))
    times = [years - (n - k) / freq for k in range(1, n + 1)]
    cpn = coupon * face / freq
    dirty = price + max(cpn * (1 - times[0] * freq), 0.0)

    def pv(y: float) -> float:
        base = 1 + y / freq
        return (sum(cpn * base ** (-freq * t) for t in times)
                + face * base ** (-freq * times[-1]))

    lo, hi = -0.5, 3.0
    if not (pv(hi) <= dirty <= pv(lo)):
        return None
    for _ in range(100):
        mid = (lo + hi) / 2
        if pv(mid) > dirty:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def analyze_bonds(rows: list[dict], treasury: dict[float, float],
                  today: date | None = None) -> list[dict]:
    """Reverse-engineer each quoted bond: YTM → spread over Treasuries → default risk."""
    today = today or date.today()
    out = []
    for r in rows or []:
        try:
            price = float(r.get("price"))
            cpn = float(r.get("coupon")) / 100.0
        except (TypeError, ValueError):
            continue
        mat = r.get("maturity")
        mat = pd.to_datetime(mat.strip() if isinstance(mat, str) else mat, errors="coerce")
        if pd.isna(mat) or any(math.isnan(v) for v in (price, cpn)):
            continue
        mat = mat.date()
        years = (mat - today).days / 365.25
        if years <= 0.05:
            continue
        ytm = bond_ytm(price, cpn, years)
        rf = interp_curve(treasury, years)
        if ytm is None or rf is None:
            continue
        out.append({"maturity": mat, "years": years, "coupon": cpn, "price": price,
                    "ytm": ytm, "treasury": rf, **spread_to_default(ytm - rf)})
    return out


def merton_default(equity_value: float, equity_vol: float, debt: float,
                   rf: float, horizon: float = 1.0) -> dict | None:
    """Merton structural model — back out the firm's assets from its share price.

    Equity is a call option on the assets struck at the debt. Given the equity
    value E and its volatility σ_E we solve
        E      = V·N(d1) − D·e^(−rT)·N(d2)
        σ_E·E  = N(d1)·σ_V·V
    for asset value V and asset volatility σ_V. PD = N(−d2) is the (risk-neutral)
    chance that assets end below the debt at the horizon.
    """
    E, sE, D, T = float(equity_value), float(equity_vol), float(debt), float(horizon)
    if E <= 0 or sE <= 0 or D <= 0 or T <= 0:
        return None
    disc = D * math.exp(-rf * T)
    sqT = math.sqrt(T)
    V = E + disc
    sV = sE * E / V

    def d12(v: float, s: float) -> tuple[float, float]:
        d1 = (math.log(v / D) + (rf + 0.5 * s * s) * T) / (s * sqT)
        return d1, d1 - s * sqT

    for _ in range(200):
        for _ in range(100):                     # Newton on the pricing equation
            d1, d2 = d12(V, sV)
            nd1 = max(_ncdf(d1), 1e-12)
            step = (V * _ncdf(d1) - disc * _ncdf(d2) - E) / nd1
            V = max(V - step, E * (1 + 1e-9))
            if abs(step) < 1e-10 * V:
                break
        d1, _ = d12(V, sV)
        sV_new = min(max(sE * E / (V * max(_ncdf(d1), 1e-12)), 1e-4), 5.0)
        if abs(sV_new - sV) < 1e-9:
            sV = sV_new
            break
        sV = sV_new

    _, d2 = d12(V, sV)
    return {"asset_value": V, "asset_vol": sV,
            "distance_to_default": d2, "pd": _ncdf(-d2)}


# ─── Adjusted EBITDA ─────────────────────────────────────────────────────────

def adjusted_ebitda(financials: pd.DataFrame | None, cashflow: pd.DataFrame | None,
                    max_years: int = 4) -> list[dict]:
    """Bridge EBIT → reported EBITDA → adjusted EBITDA, latest fiscal year first.

    Adjusted EBITDA adds back one-off items (restructuring, impairments,
    write-offs, gains/losses on sales) and stock-based compensation — the same
    adjustments companies make in their own "adjusted" figures, shown step by
    step so nothing is hidden.
    """
    rev     = _by_year(financials, ["Total Revenue", "Operating Revenue"])
    ebit    = _by_year(financials, ["EBIT"])
    op_inc  = _by_year(financials, ["Operating Income"])
    ebitda  = _by_year(financials, ["EBITDA"])
    da_is   = _by_year(financials, ["Reconciled Depreciation"])
    da_cf   = _by_year(cashflow, ["Depreciation And Amortization",
                                  "Depreciation Amortization Depletion", "Depreciation"])
    unusual = _by_year(financials, ["Total Unusual Items Excluding Goodwill",
                                    "Total Unusual Items"])
    sbc     = _by_year(cashflow, ["Stock Based Compensation"])

    rows = []
    for y in sorted(set(ebit) | set(op_inc) | set(ebitda), reverse=True)[:max_years]:
        da = da_is.get(y, da_cf.get(y))
        if y in ebit:
            base, base_label, has_one_offs = ebit[y], "EBIT", True
        elif y in ebitda and da is not None:
            base, base_label, has_one_offs = ebitda[y] - abs(da), "EBIT", True
        elif y in op_inc:
            # Operating income usually excludes the unusual items already.
            base, base_label, has_one_offs = op_inc[y], "Operating income", False
        else:
            continue
        if da is None:
            if y in ebitda and base_label == "EBIT":
                da = ebitda[y] - base
            else:
                continue
        da = abs(da)
        reported = base + da
        one_offs = -unusual.get(y, 0.0) if has_one_offs else 0.0
        stock_comp = abs(sbc.get(y, 0.0))
        adjusted = reported + one_offs + stock_comp
        revenue = rev.get(y)
        rows.append({
            "year": y, "label": f"FY{y}", "revenue": revenue,
            "base": base, "base_label": base_label, "da": da,
            "reported": reported, "one_offs": one_offs, "sbc": stock_comp,
            "adjusted": adjusted,
            "reported_margin": reported / revenue if revenue else None,
            "adjusted_margin": adjusted / revenue if revenue else None,
        })
    return rows


# ─── Putting it together ─────────────────────────────────────────────────────

def credit_lenses(*, ebit: float | None, interest: float | None, total_debt: float,
                  market_cap: float, equity_vol: float | None,
                  default_point: float | None, treasury: dict[float, float],
                  oas: dict[str, float], bonds: list[dict] | None = None,
                  is_financial: bool = False, fx_debt_to_equity: float | None = 1.0) -> dict:
    """Up to four independent reads of the same question — how likely is default?

    Each lens produces a spread over Treasuries, translated to default
    probabilities with the same credit triangle so they can be compared.
    """
    rf5 = interp_curve(treasury, CREDIT_HORIZON) or 0.04
    rf1 = interp_curve(treasury, 1.0) or rf5
    lenses = []

    def add(key, label, detail, spread):
        lenses.append({"key": key, "label": label, "detail": detail,
                       "rating": rating_from_spread(spread, oas),
                       **spread_to_default(spread)})

    if not is_financial and market_cap > 0:
        rating, detail = None, ""
        # Debt is in the reporting currency, market cap in the trading currency.
        if total_debt * (fx_debt_to_equity or 1.0) <= 0.01 * market_cap:
            rating, detail = "AAA", "Virtually no debt"
        elif interest and ebit is not None:
            cov = ebit / abs(interest)
            rating = synthetic_rating(cov, market_cap)
            detail = f"Interest covered {cov:.1f}× → {rating}"
        if rating and rating_bucket(rating) in oas:
            add("rating", "Rating-implied", detail, oas[rating_bucket(rating)])
            lenses[-1]["rating"] = rating

    if not is_financial and interest and total_debt > 0:
        cod = abs(interest) / total_debt
        add("debt_cost", "What it pays on its debt",
            f"{cod:.1%} average interest cost", max(cod - rf5, 0.0))

    if (not is_financial and equity_vol and market_cap > 0 and default_point
            and default_point > 0 and fx_debt_to_equity):
        m = merton_default(market_cap, equity_vol, default_point * fx_debt_to_equity, rf1)
        if m:
            pd1 = min(max(m["pd"], 1e-8), 0.999)
            hazard = -math.log(1 - pd1)
            add("merton", "Equity-implied (Merton)",
                f"Distance to default {m['distance_to_default']:.1f}σ",
                hazard * (1 - RECOVERY_RATE))
            lenses[-1]["distance_to_default"] = m["distance_to_default"]

    if bonds:
        avg = float(np.mean([b["spread"] for b in bonds]))
        n = len(bonds)
        add("bonds", "Your bond quotes", f"{n} bond{'s' if n != 1 else ''} priced", avg)

    headline = None
    if lenses:
        bond_lens = next((l for l in lenses if l["key"] == "bonds"), None)
        spread = bond_lens["spread"] if bond_lens else float(np.median([l["spread"] for l in lenses]))
        rating = rating_from_spread(spread, oas)
        headline = {"source": "bonds" if bond_lens else "median", "rating": rating,
                    "hist_pd_5y": HISTORICAL_PD_5Y.get(rating_bucket(rating)) if rating else None,
                    **spread_to_default(spread)}
    return {"lenses": lenses, "headline": headline, "rf5": rf5}


def leverage_ratios(latest: dict | None, total_debt: float, total_cash: float,
                    interest: float | None) -> dict:
    adj = latest["adjusted"] if latest else None
    net_debt = total_debt - total_cash
    return {
        "net_debt": net_debt,
        "net_debt_to_ebitda": net_debt / adj if adj and adj > 0 else None,
        "interest_cover": adj / abs(interest) if adj and interest else None,
        "sbc_share": latest["sbc"] / adj if latest and adj and adj > 0 else None,
    }


def build_risk_profile(stock_data: dict, factors: dict) -> dict:
    """Everything the risk view needs that doesn't depend on user bond input."""
    info = stock_data.get("info", {}) or {}
    fin  = stock_data.get("financials")
    cf   = stock_data.get("cashflow")
    bs   = stock_data.get("balance_sheet")
    h2   = stock_data.get("history_2y")
    px   = h2["Close"] if h2 is not None and not h2.empty else None

    ebitda_rows = adjusted_ebitda(fin, cf)
    latest = ebitda_rows[0] if ebitda_rows else None
    interest = _latest(fin, ["Interest Expense", "Interest Expense Non Operating"])
    total_debt = float(info.get("totalDebt") or 0)
    total_cash = float(info.get("totalCash") or 0)

    cur_debt = _latest(bs, ["Current Debt", "Current Debt And Capital Lease Obligation"])
    lt_debt  = _latest(bs, ["Long Term Debt", "Long Term Debt And Capital Lease Obligation"])
    # KMV default point: short-term debt plus half the long-term debt.
    default_point = ((cur_debt or 0) + 0.5 * (lt_debt or 0)) if (cur_debt or lt_debt) else total_debt

    return {
        "decomposition": risk_decomposition(px, factors.get("market"), factors.get("industry")),
        "downside": downside_metrics(px),
        "ebitda": ebitda_rows,
        "ratios": leverage_ratios(latest, total_debt, total_cash, interest),
        "credit_inputs": {
            "ebit": latest["base"] if latest and latest["base_label"] == "EBIT" else None,
            "interest": interest, "total_debt": total_debt,
            "market_cap": float(info.get("marketCap") or 0),
            "equity_vol": annual_volatility(px),
            "default_point": default_point,
            "is_financial": info.get("sector") == "Financial Services",
        },
        "industry_etf": factors.get("industry_etf"),
    }
