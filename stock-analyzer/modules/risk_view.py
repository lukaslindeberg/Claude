"""
Risk view — where a stock's risk comes from, what bond markets imply about
default, adjusted EBITDA, and how the company stacks up in its industry.
Plain-English headline first; every chart has its numbers one click away.
"""
from __future__ import annotations

import math

import numpy as np
import pandas as pd
import plotly.graph_objects as go
import streamlit as st

from modules.dcf import fmt
from modules.market_data import get_credit_market, get_factor_prices, get_fx_rate, get_peers
from modules.risk import (
    CREDIT_HORIZON, RATING_BUCKETS, analyze_bonds, annual_volatility,
    build_risk_profile, credit_lenses,
)

# Chart colours — checked with the dataviz palette validator against the page
# surface (#0a0e1a): lightness band, chroma, CVD separation (all pairs), contrast.
C_MARKET   = "#0e9fbf"
C_INDUSTRY = "#d95926"   # also marks management adjustments in the EBITDA bridge
C_COMPANY  = "#7c6cff"   # "this company" in every chart
C_PEER     = "#5a6379"   # de-emphasised peers / as-reported figures
C_REF      = "#8a93a8"   # Treasury reference curve
SURFACE    = "#0a0e1a"
INK, MUTED = "#e8edf7", "#8a93a8"
GRID       = "rgba(148,163,184,0.10)"
_CHART_CFG = {"displayModeBar": False}


# ─── Formatting ───────────────────────────────────────────────────────────────

def _prob(p: float | None) -> str:
    if p is None:
        return "—"
    if p < 0.001:
        return "<0.1%"
    return f"{p * 100:.2f}%" if p < 0.01 else f"{p * 100:.1f}%"


def _bps(s: float | None) -> str:
    return "—" if s is None else f"{s * 1e4:,.0f} bps"


def _money(x: float | None, ccy: str) -> str:
    if x is None:
        return "—"
    prefix = "$" if ccy in ("USD", None) else f"{ccy} "
    return ("−" if x < 0 else "") + fmt(abs(x), prefix, decimals=1)


def _ink_on(hex_color: str) -> str:
    """Dark or light label text for a coloured fill, whichever contrasts more."""
    r, g, b = (int(hex_color[i:i + 2], 16) / 255 for i in (1, 3, 5))
    lin = [c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4 for c in (r, g, b)]
    lum = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]
    return SURFACE if (lum + 0.05) / 0.0548 > 1.05 / (lum + 0.05) else "#ffffff"


def _stat(label: str, value: str) -> str:
    return (f'<div class="stat-item"><div class="stat-val">{value}</div>'
            f'<div class="stat-lbl">{label}</div></div>')


def _strip(items: list[tuple[str, str]]) -> None:
    cells = '<div class="stat-div"></div>'.join(_stat(l, v) for l, v in items)
    st.markdown(f'<div class="stat-strip">{cells}</div>', unsafe_allow_html=True)


def _layout(fig: go.Figure, height: int, legend: bool = False, **kw) -> go.Figure:
    fig.update_layout(
        height=height, margin=dict(l=0, r=10, t=34 if legend else 12, b=0),
        paper_bgcolor="rgba(0,0,0,0)", plot_bgcolor="rgba(0,0,0,0)",
        font=dict(family="Inter, sans-serif", color=MUTED, size=12),
        showlegend=legend,
        legend=dict(orientation="h", x=0, y=1.02, yanchor="bottom",
                    font=dict(color=INK, size=11), bgcolor="rgba(0,0,0,0)"),
        hoverlabel=dict(bgcolor="#161d33", bordercolor="rgba(124,108,255,0.4)",
                        font=dict(color=INK)),
        **kw,
    )
    fig.update_xaxes(gridcolor=GRID, zeroline=False, linecolor=GRID, tickfont=dict(color=MUTED))
    fig.update_yaxes(gridcolor=GRID, zeroline=False, linecolor=GRID, tickfont=dict(color=MUTED))
    return fig


def _chart(fig: go.Figure) -> None:
    st.plotly_chart(fig, use_container_width=True, config=_CHART_CFG)


# ─── Data ─────────────────────────────────────────────────────────────────────

def _ensure_profile(ticker: str, sd: dict) -> dict:
    """Heavy, bond-independent inputs — computed once per company, then reused."""
    cached = st.session_state.get("risk_profile")
    if cached and cached.get("ticker") == ticker:
        return cached
    info = sd.get("info", {}) or {}
    with st.spinner("Measuring market, credit and industry risk…"):
        market  = get_credit_market()
        factors = get_factor_prices(info.get("sector"))
        prof    = build_risk_profile(sd, factors)
        peers, peer_src = get_peers(info.get("industryKey"), ticker)
        fx = get_fx_rate(info.get("financialCurrency"), info.get("currency"))
    prof.update(ticker=ticker, market=market, peers=peers, peer_source=peer_src, fx=fx,
                has_market_prices=factors.get("market") is not None)
    st.session_state.risk_profile = prof
    return prof


def _peer_frame(ticker: str, info: dict, sd: dict, peers: pd.DataFrame) -> pd.DataFrame:
    """Peers plus the company itself, measured the same way (Yahoo TTM fields)."""
    ebitda = info.get("ebitda")
    net_debt = (info.get("totalDebt") or 0) - (info.get("totalCash") or 0)
    h1 = sd.get("history_1y")
    me = {
        "symbol": ticker, "name": info.get("shortName") or ticker,
        "market_cap": info.get("marketCap"),
        "ebitda_margin": info.get("ebitdaMargins"),
        "net_debt_ebitda": net_debt / ebitda if ebitda and ebitda > 0 else None,
        "beta": info.get("beta"),
        "volatility": annual_volatility(h1["Close"]) if h1 is not None and not h1.empty else None,
    }
    df = pd.concat([peers, pd.DataFrame([me])], ignore_index=True) if not peers.empty \
        else pd.DataFrame([me])
    df["is_self"] = df["symbol"] == ticker
    return df


# ─── Headline ─────────────────────────────────────────────────────────────────

def _headline(name: str, ticker: str, credit: dict, prof: dict, ccy: str) -> None:
    hl, dec = credit.get("headline"), prof.get("decomposition")
    rows, ratios = prof.get("ebitda") or [], prof.get("ratios") or {}
    latest = rows[0] if rows else None

    rating = hl["rating"] if hl else "—"
    if hl:
        rating_sub = f"Spread {_bps(hl['spread'])} prices in {_prob(hl['pd_5y'])} default risk over 5 yrs"
        if hl.get("hist_pd_5y") is not None:
            rating_sub += (f'<div class="bento-note">Historically ~{_prob(hl["hist_pd_5y"])} '
                           f"of {rating}-rated companies defaulted within 5 yrs</div>")
    else:
        rating_sub = "Not enough data to price credit risk"
    co_val = f"{dec['company_share']:.0%}" if dec else "—"
    co_sub = (f"of price swings · β {dec['beta']:.2f} to the S&P 500" if dec
              else "Needs 6+ months of prices")
    eb_val = _money(latest["adjusted"], ccy) if latest else "—"
    eb_sub = (f"{latest['adjusted_margin']:.1%} margin · {latest['label']}"
              if latest and latest["adjusted_margin"] is not None else "Not reported")
    nde = ratios.get("net_debt_to_ebitda")
    lev_val = "—" if nde is None else ("Net cash" if nde < 0 else f"{nde:.1f}×")
    cover = ratios.get("interest_cover")
    lev_sub = f"interest covered {cover:.0f}×" if cover else "Leverage"

    st.markdown(
        '<div class="bento bento-4 bento-risk">'
        f'<div class="bento-cell bento-hero"><div class="bento-lbl">Implied credit rating</div>'
        f'<div class="bento-val">{rating}</div><div class="bento-sub">{rating_sub}</div></div>'
        f'<div class="bento-cell"><div class="bento-lbl">Company-specific risk</div>'
        f'<div class="bento-val-sm">{co_val}</div><div class="bento-sub">{co_sub}</div></div>'
        f'<div class="bento-cell"><div class="bento-lbl">Adjusted EBITDA</div>'
        f'<div class="bento-val-sm">{eb_val}</div><div class="bento-sub">{eb_sub}</div></div>'
        f'<div class="bento-cell"><div class="bento-lbl">Net debt / Adj. EBITDA</div>'
        f'<div class="bento-val-sm">{lev_val}</div><div class="bento-sub">{lev_sub}</div></div>'
        '</div>',
        unsafe_allow_html=True,
    )

    lines = []
    if hl:
        src = "your bond quotes" if hl["source"] == "bonds" else "the market"
        article = "an" if hl["rating"][0] == "A" else "a"
        line = (f"Bond markets price <strong>{name}</strong> like {article} "
                f"<strong>{hl['rating']}</strong> credit: the spread {src} demands implies "
                f"<strong>{_prob(hl['pd_5y'])}</strong> default risk over five years")
        if hl.get("hist_pd_5y") is not None:
            line += (f" — that includes a premium for bearing the risk; historically about "
                     f"{_prob(hl['hist_pd_5y'])} of {hl['rating']}-rated companies defaulted "
                     "that fast")
        lines.append(line + ".")
    if dec:
        rest = f"the overall market ({dec['market_share']:.0%})"
        if dec["has_industry"]:
            rest += f" and its industry ({dec['industry_share']:.0%})"
        lines.append(f"<strong>{dec['company_share']:.0%}</strong> of its price swings are "
                     f"company-specific; the rest comes from {rest}.")
    if lines:
        st.markdown(f'<div class="risk-summary">{" ".join(lines)}</div>', unsafe_allow_html=True)
    credit_txt = (f"{rating}, spread {_bps(hl['spread'])}, market-implied 5-yr default risk "
                  f"{_prob(hl['pd_5y'])}" if hl else "unavailable")
    st.session_state.risk_summary = (
        f"Implied credit rating {credit_txt}; company-specific share of risk {co_val}; "
        f"adjusted EBITDA {eb_val} ({eb_sub}); net debt / adj. EBITDA {lev_val}."
    )


# ─── Section 1 · Market vs company-specific risk ──────────────────────────────

def _section_market_risk(ticker: str, prof: dict) -> None:
    st.markdown('<div class="sec">Where the risk comes from</div>', unsafe_allow_html=True)
    dec, down = prof.get("decomposition"), prof.get("downside")
    if not dec:
        st.caption("S&P 500 prices are unavailable right now — try refreshing later."
                   if not prof.get("has_market_prices") else
                   "Not enough overlapping price history with the S&P 500 to split the risk.")
        return

    etf = prof.get("industry_etf") or "sector"
    segs = [("Market", dec["market_share"], C_MARKET, "moves with the S&P 500")]
    if dec["has_industry"]:
        segs.append(("Industry", dec["industry_share"], C_INDUSTRY, f"moves with its sector ({etf})"))
    segs.append(("Company-specific", dec["company_share"], C_COMPANY,
                 "earnings, news, execution — diversifiable"))

    bar = "".join(
        f'<div class="rd-seg" style="flex:{max(s, 0.001):.4f} 1 0;background:{c};color:{_ink_on(c)};" '
        f'title="{lbl}: {s:.0%} — {why}">{f"{s:.0%}" if s >= 0.12 else ""}</div>'
        for lbl, s, c, why in segs
    )
    legend = "".join(
        f'<div class="rd-key"><span class="rd-sw" style="background:{c};"></span>'
        f'<b>{lbl}</b>&nbsp;{s:.0%}<span class="rd-why">· {why}</span></div>'
        for lbl, s, c, why in segs
    )
    st.markdown(f'<div class="rd-bar">{bar}</div><div class="rd-legend">{legend}</div>',
                unsafe_allow_html=True)

    items = [("Beta vs S&P 500", f"{dec['beta']:.2f}"),
             ("Volatility · 1 yr", f"{down['ann_vol']:.0%}" if down else "—"),
             ("Company-specific vol", f"{dec['company_vol']:.0%}")]
    if down:
        items += [("1-day loss, 1-in-20", f"−{down['var_95']:.1%}"),
                  ("Max drawdown · 1 yr", f"{down['max_drawdown']:.0%}")]
    _strip(items)
    st.caption(f"When the S&P 500 moves 1%, {ticker} has typically moved {dec['beta']:.2f}%. "
               f"Based on {dec['weeks']} weeks of returns.")


# ─── Section 2 · Credit risk ──────────────────────────────────────────────────

_BOND_COLS = {"Maturity": pd.Series(dtype="object"),
              "Coupon %": pd.Series(dtype="float"),
              "Price": pd.Series(dtype="float")}


def _bond_editor(ticker: str) -> list[dict]:
    """Rows the user has started filling in (complete or not)."""
    has_quotes = bool(st.session_state.get(f"bonds_{ticker}", {}).get("added_rows"))
    with st.expander(f"Price {ticker}'s actual bonds — enter quotes to reverse-engineer "
                     "their implied default risk", expanded=has_quotes):
        st.caption("Find quotes on FINRA's bond center (finra-markets.morningstar.com/BondCenter) "
                   "or your broker. Use the clean price per 100 of face value, "
                   "for USD bonds.")
        edited = st.data_editor(
            pd.DataFrame(_BOND_COLS), key=f"bonds_{ticker}", num_rows="dynamic",
            use_container_width=True, hide_index=True,
            column_config={
                # Plain text so dates paste cleanly from FINRA or a broker screen.
                "Maturity": st.column_config.TextColumn(
                    "Maturity", help="e.g. 2030-05-10, 05/10/2030 or May 10 2030"),
                "Coupon %": st.column_config.NumberColumn("Coupon %", min_value=0.0,
                                                          max_value=30.0, format="%.3f"),
                "Price": st.column_config.NumberColumn("Price (per 100)", min_value=1.0,
                                                       max_value=250.0, format="%.3f"),
            },
        )
    filled = lambda v: pd.notna(v) and str(v).strip() != ""
    return [{"maturity": r["Maturity"], "coupon": r["Coupon %"], "price": r["Price"]}
            for r in edited.to_dict("records")
            if any(filled(r.get(k)) for k in ("Maturity", "Coupon %", "Price"))]


def _lens_chart(lenses: list[dict], oas: dict) -> go.Figure:
    rows = list(reversed(lenses))                     # first lens on top
    # Keep the rating ladder readable: estimates far below AAA (e.g. a debt-free
    # firm under Merton) are pinned at the left edge and labelled as such.
    lo = oas["AAA"] * 1e4 / 2.2
    hi = max([l["spread"] * 1e4 for l in rows] + [oas["CCC"] * 1e4]) * 1.5
    xs = [max(l["spread"] * 1e4, lo * 1.08) for l in rows]
    labels = [f"  {l['rating']}" + (" · ≈0 bps" if l["spread"] * 1e4 < lo else "")
              for l in rows]
    ticks = [t for t in (10, 25, 50, 100, 250, 500, 1000, 2500) if lo <= t <= hi]

    fig = go.Figure()
    for k, b in enumerate(RATING_BUCKETS):            # the rating ladder, as reference rules
        v = oas[b] * 1e4
        fig.add_vline(x=v, line_width=1, line_color="rgba(148,163,184,0.22)")
        fig.add_annotation(x=math.log10(v), y=1.0 + (0.1 if k % 2 else 0.02), yref="paper",
                           text=b, showarrow=False, font=dict(color=MUTED, size=10),
                           yanchor="bottom")
    fig.add_trace(go.Scatter(
        x=xs, y=[l["label"] for l in rows], mode="markers+text",
        marker=dict(size=15, color=C_COMPANY, line=dict(color=SURFACE, width=2)),
        text=labels, textposition="middle right",
        textfont=dict(color=INK, size=12),
        customdata=[[_bps(l["spread"]), _prob(l["pd_5y"]), l["detail"]] for l in rows],
        hovertemplate="<b>%{y}</b><br>%{customdata[0]} over Treasuries<br>"
                      "5-yr default risk %{customdata[1]}<br>%{customdata[2]}<extra></extra>",
    ))
    _layout(fig, 96 + 50 * len(rows))
    fig.update_layout(margin=dict(l=0, r=10, t=44, b=0))
    fig.update_xaxes(type="log", range=[math.log10(lo), math.log10(hi)],
                     tickvals=ticks, ticktext=[f"{t:,}" for t in ticks],
                     title=dict(text="Implied spread over Treasuries (bps, log scale)",
                                font=dict(size=11, color=MUTED)))
    fig.update_yaxes(showgrid=False, automargin=True, tickfont=dict(color=INK))
    return fig


def _curve_chart(ticker: str, treasury: dict, spread: float | None, bonds: list[dict]) -> go.Figure:
    mats = sorted(treasury)
    tsy = [treasury[m] * 100 for m in mats]
    fig = go.Figure()
    fig.add_trace(go.Scatter(x=mats, y=tsy, name="US Treasury", mode="lines",
                             line=dict(color=C_REF, width=2),
                             hovertemplate="Treasury %{x:.2g} yr: %{y:.2f}%<extra></extra>"))
    ends = [("Treasury", tsy[-1])]
    if spread is not None:
        co = [y + spread * 100 for y in tsy]
        fig.add_trace(go.Scatter(x=mats, y=co, name=f"{ticker} implied (+{spread * 1e4:,.0f} bps)",
                                 mode="lines", line=dict(color=C_COMPANY, width=2),
                                 hovertemplate=f"{ticker} %{{x:.2g}} yr: %{{y:.2f}}%<extra></extra>"))
        ends.append((ticker, co[-1]))
    if bonds:
        fig.add_trace(go.Scatter(
            x=[b["years"] for b in bonds], y=[b["ytm"] * 100 for b in bonds],
            name="Your bond quotes", mode="markers",
            marker=dict(size=12, color=C_COMPANY, symbol="diamond",
                        line=dict(color=SURFACE, width=2)),
            customdata=[[b["maturity"].isoformat(), _bps(b["spread"])] for b in bonds],
            hovertemplate="Matures %{customdata[0]}<br>Yield %{y:.2f}% · "
                          "%{customdata[1]} over Treasuries<extra></extra>"))
    for label, y in ends:                              # direct end labels
        fig.add_annotation(x=mats[-1], y=y, text=label, showarrow=False, xanchor="left",
                           xshift=6, font=dict(color=INK, size=11))
    _layout(fig, 300, legend=True)
    fig.update_layout(margin=dict(l=0, r=64, t=34, b=0))
    fig.update_xaxes(title=dict(text="Years to maturity", font=dict(size=11, color=MUTED)),
                     range=[0, mats[-1] + 0.5])
    fig.update_yaxes(ticksuffix="%", title=dict(text="Yield", font=dict(size=11, color=MUTED)))
    return fig


def _section_credit(ticker: str, info: dict, prof: dict) -> dict:
    st.markdown('<div class="sec">What the bond market implies</div>', unsafe_allow_html=True)
    market = prof["market"]
    entered = _bond_editor(ticker)
    bonds = analyze_bonds(entered, market["treasury"])
    if len(entered) > len(bonds):
        st.warning(f"{len(entered) - len(bonds)} of your bond rows couldn't be priced — each "
                   "needs a future maturity date, a coupon and a price between 1 and 250.")
    credit = credit_lenses(**prof["credit_inputs"], treasury=market["treasury"],
                           oas=market["oas"], bonds=bonds, fx_debt_to_equity=prof.get("fx"))

    if not credit["lenses"]:
        if prof["credit_inputs"]["is_financial"]:
            st.info("For banks and insurers, leverage is the business model, so coverage- and "
                    "equity-based credit models don't apply. Enter bond quotes above to see "
                    "what the bond market implies.")
        else:
            st.info("Not enough debt or interest data to estimate credit risk. "
                    "Enter bond quotes above to price it directly.")
        return credit

    n = len(credit["lenses"])
    title = ("One read" if n == 1 else
             f"{['Two', 'Three', 'Four'][n - 2]} ways to read") + " default risk"
    c1, c2 = st.columns([1.05, 1], gap="large")
    with c1:
        st.markdown(f'<div class="chart-h">{title}</div>'
                    '<div class="chart-sub">Each dot is an independent estimate, placed on '
                    "today's rating ladder</div>", unsafe_allow_html=True)
        _chart(_lens_chart(credit["lenses"], market["oas"]))
    with c2:
        st.markdown('<div class="chart-h">What it would cost to borrow</div>'
                    '<div class="chart-sub">Treasury curve plus the implied credit spread'
                    "</div>", unsafe_allow_html=True)
        hl = credit.get("headline")
        _chart(_curve_chart(ticker, market["treasury"], hl["spread"] if hl else None, bonds))

    with st.expander("The numbers behind these charts"):
        st.dataframe(pd.DataFrame([{
            "Lens": l["label"], "How": l["detail"], "Spread (bps)": round(l["spread"] * 1e4),
            "Implied rating": l["rating"], "1-yr default": _prob(l["pd_1y"]),
            "5-yr default": _prob(l["pd_5y"]),
        } for l in credit["lenses"]]), hide_index=True, use_container_width=True)
        if bonds:
            st.dataframe(pd.DataFrame([{
                "Maturity": b["maturity"], "Coupon": f"{b['coupon']:.3%}",
                "Price": b["price"], "Yield": f"{b['ytm']:.2%}",
                "Treasury": f"{b['treasury']:.2%}", "Spread (bps)": round(b["spread"] * 1e4),
                "5-yr default": _prob(b["pd_5y"]),
            } for b in bonds]), hide_index=True, use_container_width=True)

    as_of = f" · as of {market['as_of']}" if market.get("as_of") else ""
    st.caption(f"Spreads: {market['oas_source']}{as_of}. Yields: {market['treasury_source']}. "
               "Default odds are market-implied (they include a risk premium), "
               "assuming 40% recovery.")
    return credit


# ─── Section 3 · Adjusted EBITDA ─────────────────────────────────────────────

def _waterfall(latest: dict, ccy: str) -> go.Figure:
    steps = [(latest["base_label"], latest["base"], "abs", C_PEER),
             ("+ D&A", latest["da"], "rel", C_PEER),
             ("Reported EBITDA", latest["reported"], "tot", C_COMPANY)]
    if abs(latest["one_offs"]) > 0:
        steps.append(("+ One-offs" if latest["one_offs"] > 0 else "− One-off gains",
                      latest["one_offs"], "rel", C_INDUSTRY))
    if latest["sbc"] > 0:
        steps.append(("+ Stock comp", latest["sbc"], "rel", C_INDUSTRY))
    steps.append(("Adjusted EBITDA", latest["adjusted"], "tot", C_COMPANY))

    x, base, height, colors, text, run = [], [], [], [], [], 0.0
    for label, v, kind, c in steps:
        if kind == "rel":
            b, h = (run, v) if v >= 0 else (run + v, -v)
            run += v
        else:
            b, h, run = 0.0, v, v
        x.append(label); base.append(b); height.append(h); colors.append(c)
        text.append(_money(v, ccy))
    fig = go.Figure(go.Bar(
        x=x, y=height, base=base, marker=dict(color=colors, cornerradius=4),
        text=text, textposition="outside", textfont=dict(color=INK, size=11),
        constraintext="none", cliponaxis=False,
        hovertemplate="%{x}: %{text}<extra></extra>",
    ))
    _layout(fig, 300, bargap=0.62)
    fig.update_yaxes(showticklabels=False, showgrid=False)
    fig.update_xaxes(tickfont=dict(color=INK, size=11))
    return fig


def _ebitda_trend(rows: list[dict], ccy: str) -> go.Figure:
    rows = list(reversed(rows))                       # oldest → newest
    labels = [r["label"] for r in rows]
    margin = lambda r, k: f"{r[k]:.1%}" if r[k] is not None else "—"
    top = max(abs(r["adjusted"]) for r in rows)
    div, unit = (1e9, "B") if top >= 1e9 else (1e6, "M") if top >= 1e6 else (1.0, "")
    fig = go.Figure()
    fig.add_trace(go.Bar(
        x=labels, y=[r["reported"] / div for r in rows], name="Reported EBITDA",
        marker=dict(color=C_PEER, cornerradius=4),
        customdata=[[_money(r["reported"], ccy), margin(r, "reported_margin")] for r in rows],
        hovertemplate="%{x} reported: %{customdata[0]} · %{customdata[1]} margin<extra></extra>"))
    fig.add_trace(go.Bar(
        x=labels, y=[r["adjusted"] / div for r in rows], name="Adjusted EBITDA",
        marker=dict(color=C_COMPANY, cornerradius=4),
        text=[""] * (len(rows) - 1) + [_money(rows[-1]["adjusted"], ccy)],
        textposition="outside", textfont=dict(color=INK, size=11), cliponaxis=False,
        constraintext="none",
        customdata=[[_money(r["adjusted"], ccy), margin(r, "adjusted_margin")] for r in rows],
        hovertemplate="%{x} adjusted: %{customdata[0]} · %{customdata[1]} margin<extra></extra>"))
    _layout(fig, 300, legend=True, barmode="group", bargap=0.5, bargroupgap=0.12)
    fig.update_yaxes(tickprefix="$" if ccy == "USD" else f"{ccy} ", ticksuffix=unit,
                     tickformat=",.0f")
    return fig


def _section_ebitda(prof: dict, ccy: str) -> None:
    st.markdown('<div class="sec">Adjusted EBITDA</div>', unsafe_allow_html=True)
    rows = prof.get("ebitda") or []
    if not rows:
        st.info("EBITDA isn't meaningful for banks and insurers."
                if prof["credit_inputs"]["is_financial"]
                else "Not enough income-statement detail to build an EBITDA bridge.")
        return
    latest, ratios = rows[0], prof.get("ratios") or {}

    c1, c2 = st.columns([1.1, 1], gap="large")
    with c1:
        st.markdown(f'<div class="chart-h">From {latest["base_label"]} to adjusted EBITDA · '
                    f'{latest["label"]}</div><div class="chart-sub">Grey is as reported, '
                    "orange is what gets added back</div>", unsafe_allow_html=True)
        _chart(_waterfall(latest, ccy))
    with c2:
        st.markdown('<div class="chart-h">Reported vs adjusted, by year</div>'
                    '<div class="chart-sub">The gap is the adjustments</div>',
                    unsafe_allow_html=True)
        _chart(_ebitda_trend(rows, ccy))

    nde, cover, sbc = (ratios.get("net_debt_to_ebitda"), ratios.get("interest_cover"),
                       ratios.get("sbc_share"))
    _strip([
        ("Adj. EBITDA margin", f"{latest['adjusted_margin']:.1%}" if latest["adjusted_margin"] is not None else "—"),
        ("Net debt / Adj. EBITDA", "—" if nde is None else ("Net cash" if nde < 0 else f"{nde:.1f}×")),
        ("Adj. EBITDA / interest", f"{cover:.0f}×" if cover else "—"),
        ("Stock comp share", f"{sbc:.0%}" if sbc is not None else "—"),
    ])
    if sbc and sbc > 0.15:
        st.caption(f"Heads-up: stock-based pay is {sbc:.0%} of adjusted EBITDA. It's a real cost "
                   "to shareholders (dilution), so the adjusted figure flatters cash profits.")


# ─── Section 4 · Industry ─────────────────────────────────────────────────────

def _risk_map(df: pd.DataFrame, ticker: str) -> go.Figure:
    d = df.dropna(subset=["net_debt_ebitda", "volatility"]).copy()
    d["x"] = d["net_debt_ebitda"].clip(-3, 8)
    d["y"] = d["volatility"] * 100
    fig = go.Figure()
    for is_self, color, size, name in ((False, C_PEER, 11, "Peers"), (True, C_COMPANY, 16, ticker)):
        p = d[d["is_self"] == is_self]
        fig.add_trace(go.Scatter(
            x=p["x"], y=p["y"], mode="markers+text", name=name,
            marker=dict(size=size, color=color, line=dict(color=SURFACE, width=2)),
            text=p["symbol"] if not is_self else "  " + p["symbol"],
            textposition="middle right" if is_self else "top center",
            textfont=dict(color=INK if is_self else MUTED, size=12 if is_self else 10),
            customdata=np.stack([p["name"], p["net_debt_ebitda"].map(lambda v: f"{v:.1f}×")], axis=-1),
            hovertemplate="<b>%{customdata[0]}</b><br>Net debt / EBITDA %{customdata[1]}"
                          "<br>Volatility %{y:.0f}%<extra></extra>"))
    peers = d[~d["is_self"]]
    if len(peers) >= 2:
        mx, my = peers["x"].median(), peers["y"].median()
        fig.add_vline(x=mx, line_width=1, line_color="rgba(148,163,184,0.30)")
        fig.add_hline(y=my, line_width=1, line_color="rgba(148,163,184,0.30)")
        fig.add_annotation(x=mx, y=1, yref="paper", text="median", showarrow=False,
                           xanchor="left", xshift=4, font=dict(color=MUTED, size=10))
    _layout(fig, 340, legend=True)
    fig.update_xaxes(title=dict(text="Net debt / EBITDA (×) — left of 0 is net cash",
                                font=dict(size=11, color=MUTED)))
    fig.update_yaxes(ticksuffix="%", title=dict(text="Volatility, 1 yr",
                                                font=dict(size=11, color=MUTED)))
    return fig


def _margin_bars(df: pd.DataFrame) -> go.Figure:
    d = df.dropna(subset=["ebitda_margin"]).sort_values("ebitda_margin")
    fig = go.Figure(go.Bar(
        x=d["ebitda_margin"] * 100, y=d["symbol"], orientation="h",
        marker=dict(color=[C_COMPANY if s else C_PEER for s in d["is_self"]], cornerradius=4),
        text=[f"{m:.0%}" if s else "" for m, s in zip(d["ebitda_margin"], d["is_self"])],
        textposition="outside", textfont=dict(color=INK, size=11), cliponaxis=False,
        customdata=d["name"],
        hovertemplate="<b>%{customdata}</b><br>EBITDA margin %{x:.1f}%<extra></extra>"))
    peers = d[~d["is_self"]]
    if len(peers) >= 2:
        med = peers["ebitda_margin"].median() * 100
        fig.add_vline(x=med, line_width=1, line_color="rgba(148,163,184,0.45)")
        fig.add_annotation(x=med, y=1, yref="paper", yanchor="bottom",
                           text=f"median {med:.0f}%", showarrow=False,
                           font=dict(color=MUTED, size=10))
    _layout(fig, 60 + 34 * len(d), bargap=0.4)
    fig.update_layout(margin=dict(l=0, r=36, t=22, b=0))
    fig.update_xaxes(ticksuffix="%")
    fig.update_yaxes(showgrid=False, tickfont=dict(color=INK))
    return fig


def _section_industry(ticker: str, info: dict, sd: dict, prof: dict) -> None:
    industry = info.get("industry") or info.get("sector") or "its industry"
    st.markdown(f'<div class="sec">Versus its industry · {industry}</div>', unsafe_allow_html=True)
    df = _peer_frame(ticker, info, sd, prof.get("peers", pd.DataFrame()))
    if (~df["is_self"]).sum() < 2:
        st.caption("Peer data isn't available right now — try refreshing later.")
        return

    c1, c2 = st.columns([1.25, 1], gap="large")
    with c1:
        st.markdown('<div class="chart-h">Risk map</div><div class="chart-sub">'
                    "Balance-sheet risk (across) vs share-price risk (up) — "
                    "up and to the right is riskier on both</div>",
                    unsafe_allow_html=True)
        _chart(_risk_map(df, ticker))
    with c2:
        st.markdown('<div class="chart-h">EBITDA margin</div><div class="chart-sub">'
                    "How much of each sales dollar becomes operating cash profit</div>",
                    unsafe_allow_html=True)
        _chart(_margin_bars(df))

    with st.expander("Peer table"):
        t = df.sort_values("market_cap", ascending=False)
        st.dataframe(pd.DataFrame({
            "Company": t["name"], "Ticker": t["symbol"],
            "Market cap": t["market_cap"].map(lambda v: fmt(v, "$", decimals=1) if pd.notna(v) else "—"),
            "EBITDA margin": t["ebitda_margin"].map(lambda v: f"{v:.1%}" if pd.notna(v) else "—"),
            "Net debt / EBITDA": t["net_debt_ebitda"].map(lambda v: f"{v:.1f}×" if pd.notna(v) else "—"),
            "Volatility": t["volatility"].map(lambda v: f"{v:.0%}" if pd.notna(v) else "—"),
            "Beta": t["beta"].map(lambda v: f"{v:.2f}" if pd.notna(v) else "—"),
        }), hide_index=True, use_container_width=True)
    if prof.get("peer_source"):
        st.caption(f"Peers: {prof['peer_source']}. Trailing-twelve-month figures for everyone, "
                   f"so {ticker}'s margin here can differ slightly from the fiscal-year bridge above.")


# ─── Page ─────────────────────────────────────────────────────────────────────

def render_risk_view(ticker: str, stock_data: dict, key_metrics: dict) -> None:
    info = stock_data.get("info", {}) or {}
    prof = _ensure_profile(ticker, stock_data)
    name = key_metrics.get("name") or ticker
    ccy = info.get("financialCurrency") or info.get("currency") or "USD"

    head = st.container()   # filled last — its numbers depend on the bond quotes below
    _section_market_risk(ticker, prof)
    credit = _section_credit(ticker, info, prof)
    _section_ebitda(prof, ccy)
    _section_industry(ticker, info, stock_data, prof)

    with st.expander("How these numbers are estimated"):
        etf = prof.get("industry_etf") or "a sector ETF"
        st.markdown(f"""
**Market vs company-specific risk.** Two years of weekly returns are regressed on the
S&P 500 (SPY) and on {etf}, with the sector's own moves separated from the market's.
Each share is that factor's slice of the stock's return variance. Company-specific
risk is the part a diversified portfolio averages away.

**Credit — four independent lenses**, each turned into a spread over US Treasuries and
then into default odds with the *credit triangle*: yearly default intensity =
spread ÷ (1 − 40% recovery).
- *Rating-implied* — interest coverage (EBIT ÷ interest) mapped to a synthetic rating
  (Damodaran's table), priced at today's ICE BofA spread for that rating.
- *What it pays on its debt* — interest expense ÷ total debt, minus the 5-year Treasury.
  Backward-looking: it reflects rates when the debt was issued.
- *Equity-implied (Merton)* — treats the shares as a call option on the firm's assets,
  backs out asset value and volatility from the share price, and measures the
  distance to the default point (short-term debt + ½ long-term debt).
- *Your bond quotes* — yield to maturity from the price you enter, minus the Treasury
  yield at the same maturity. When present, it drives the headline.

Market-implied default odds include a risk premium, so they sit above historical
default rates — read them as "what investors are charging for", not a forecast.

**Adjusted EBITDA.** EBIT + depreciation & amortisation = reported EBITDA. One-off items
(restructuring, impairments, write-offs, gains on asset sales) and stock-based
compensation are then added back — the same adjustments companies make in their own
"adjusted" figures, shown step by step.
""")

    with head:
        _headline(name, ticker, credit, prof, ccy)
