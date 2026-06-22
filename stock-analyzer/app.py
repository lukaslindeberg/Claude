"""
Intrinsic — Know what it's really worth. Modern UI with smart natural-language search.
"""
import streamlit as st
import pandas as pd
import numpy as np
import plotly.graph_objects as go
import plotly.express as px
from datetime import datetime
from pathlib import Path

from modules.stock_data import search_companies, get_comprehensive_data, get_key_metrics
from modules.dcf import run_dcf_model, enrich_with_advanced, sensitivity_table, fmt
from modules.hype import calculate_hype_score
from modules.ai_analysis import (
    check_ollama_status, get_available_models,
    extract_company_from_query,
    generate_dcf_narrative, analyze_news_sentiment,
    analyze_valuation_gap, calculate_confidence_score,
)
from modules.scores import (
    piotroski_f_score, altman_z_score,
    calculate_pentagon, historical_financials, stock_rank,
    financial_health_score,
)

# ─── Page config ──────────────────────────────────────────────────────────────
st.set_page_config(
    page_title="Intrinsic — Know what it's really worth",
    page_icon="◆",
    layout="wide",
    initial_sidebar_state="expanded",
)

# ─── Plotly dark theme ────────────────────────────────────────────────────────
import plotly.io as pio

_INK        = "#e8edf7"
_INK_MUTED  = "#8a93a8"
_GRID       = "rgba(148,163,184,0.10)"
_ACCENT     = "#7c6cff"
_CHART_SEQ  = ["#7c6cff", "#22d3ee", "#34d399", "#f59e0b", "#f43f5e", "#a855f7"]

pio.templates["intrinsic"] = go.layout.Template(
    layout=dict(
        paper_bgcolor="rgba(0,0,0,0)",
        plot_bgcolor="rgba(0,0,0,0)",
        font=dict(family="Inter, sans-serif", color=_INK, size=12),
        colorway=_CHART_SEQ,
        xaxis=dict(gridcolor=_GRID, zerolinecolor=_GRID, linecolor=_GRID,
                   tickfont=dict(color=_INK_MUTED)),
        yaxis=dict(gridcolor=_GRID, zerolinecolor=_GRID, linecolor=_GRID,
                   tickfont=dict(color=_INK_MUTED)),
        legend=dict(font=dict(color=_INK_MUTED)),
        hoverlabel=dict(bgcolor="#161d33", font=dict(color=_INK),
                        bordercolor="rgba(124,108,255,0.4)"),
    )
)
pio.templates.default = "intrinsic"

# ─── Design tokens & CSS ──────────────────────────────────────────────────────
def _load_css() -> None:
    css = (Path(__file__).parent / "assets" / "style.css").read_text()
    st.markdown(f"<style>{css}</style>", unsafe_allow_html=True)

_load_css()



# ─── Session state ────────────────────────────────────────────────────────────
_DEFAULTS = {
    "selected_ticker": None, "selected_name": None,
    "stock_data": None, "key_metrics": None,
    "dcf_results": None, "hype_data": None,
    "confidence": None,
    "scores": None,
    "ai_dcf": None, "ai_news": None, "ai_val": None,
    "search_results": [], "last_query": "",
    "pending_query": None,
    "advanced_done": False,
    "_rf": 4.5, "_mrp": 5.5, "_tg": 2.5, "_ga": 0.0,
}
for _k, _v in _DEFAULTS.items():
    if _k not in st.session_state:
        st.session_state[_k] = _v


# ─── Helpers ──────────────────────────────────────────────────────────────────
def _pct(v, sign=True, d=1) -> str:
    if v is None: return "N/A"
    s = f"{v:.{d}f}%"
    return ("+" if v > 0 else "") + s if sign else s

def _price(v, d=2) -> str:
    return f"${v:.{d}f}" if v is not None else "N/A"

def _cc(v) -> str:          # colour class
    return "green" if (v or 0) > 0 else "red"

def _kpi(label, value, sub=None, sub_cls=""):
    sub_html = f'<div class="kpi-sub {sub_cls}">{sub}</div>' if sub else ""
    st.markdown(
        f'<div class="kpi"><div class="kpi-lbl">{label}</div>'
        f'<div class="kpi-val">{value}</div>{sub_html}</div>',
        unsafe_allow_html=True,
    )


# ─── Sidebar ──────────────────────────────────────────────────────────────────
def render_sidebar() -> tuple[str | None, dict]:
    with st.sidebar:
        st.markdown(
            '<div class="brand">'
            '<div class="brand-mark">◆</div>'
            '<div><div class="brand-name">Intrinsic</div>'
            '<div class="brand-tag">Know what it\'s worth</div></div>'
            '</div>',
            unsafe_allow_html=True,
        )
        st.markdown("---")
        st.markdown('<div class="side-h">AI Engine</div>', unsafe_allow_html=True)

        ollama_ok = check_ollama_status()
        if ollama_ok:
            models = get_available_models()
            if models:
                st.markdown(
                    '<div class="status-chip status-ok"><span class="dot dot-ok"></span>'
                    f'Ollama connected · {len(models)} model{"s" if len(models)!=1 else ""}</div>',
                    unsafe_allow_html=True,
                )
                model = st.selectbox("Model", models, label_visibility="collapsed")
            else:
                st.markdown(
                    '<div class="status-chip status-off"><span class="dot dot-off"></span>'
                    'Connected · no models</div>',
                    unsafe_allow_html=True,
                )
                st.caption("Pull one with:  `ollama pull llama3.2`")
                model = None
        else:
            st.markdown(
                '<div class="status-chip status-idle"><span class="dot dot-idle"></span>'
                'AI · not connected</div>',
                unsafe_allow_html=True,
            )
            st.caption("All data & valuation works without AI. "
                       "Install **ollama.ai** and run `ollama serve` to enable insights.")
            model = None

        has_ticker = bool(st.session_state.get("selected_ticker"))

        if has_ticker:
            st.markdown("---")
            with st.expander("⚙️  DCF Assumptions", expanded=False):
                st.markdown(
                    '<div style="font-size:0.63rem;font-weight:700;text-transform:uppercase;'
                    'letter-spacing:1.5px;color:#64748b;margin-bottom:10px;">Scenario Presets</div>',
                    unsafe_allow_html=True,
                )
                c1, c2, c3 = st.columns(3)
                with c1:
                    if st.button("🐻 Bear", use_container_width=True):
                        st.session_state["_rf"]  = 5.0
                        st.session_state["_mrp"] = 6.5
                        st.session_state["_tg"]  = 1.5
                        st.session_state["_ga"]  = -5.0
                with c2:
                    if st.button("📊 Base", use_container_width=True):
                        st.session_state["_rf"]  = 4.5
                        st.session_state["_mrp"] = 5.5
                        st.session_state["_tg"]  = 2.5
                        st.session_state["_ga"]  =  0.0
                with c3:
                    if st.button("🐂 Bull", use_container_width=True):
                        st.session_state["_rf"]  = 3.5
                        st.session_state["_mrp"] = 4.5
                        st.session_state["_tg"]  = 3.5
                        st.session_state["_ga"]  =  5.0

                st.markdown(
                    '<div style="font-size:0.63rem;font-weight:700;text-transform:uppercase;'
                    'letter-spacing:1.5px;color:#64748b;margin:14px 0 6px;">Parameters</div>',
                    unsafe_allow_html=True,
                )
                rf  = st.slider("Risk-Free Rate (%)",      1.0, 8.0,  step=0.1, key="_rf")  / 100
                mrp = st.slider("Market Risk Premium (%)", 3.0, 9.0,  step=0.1, key="_mrp") / 100
                tg  = st.slider("Terminal Growth (%)",     0.5, 5.0,  step=0.1, key="_tg")  / 100
                ga  = st.slider("Growth Adjustment (%)", -15.0, 15.0, step=0.5, key="_ga")  / 100
        else:
            rf  = st.session_state.get("_rf",  4.5) / 100
            mrp = st.session_state.get("_mrp", 5.5) / 100
            tg  = st.session_state.get("_tg",  2.5) / 100
            ga  = st.session_state.get("_ga",  0.0) / 100

        assumptions = {
            "risk_free_rate": rf, "market_risk_premium": mrp,
            "terminal_growth": tg, "growth_adjustment": ga,
            "projection_years": 5,
        }

        st.markdown(
            '<div class="sidebar-footer">'
            '<span>Data · Yahoo Finance · AI · Ollama (local)</span>'
            '<span>Educational only — not financial advice.</span>'
            '</div>',
            unsafe_allow_html=True,
        )

    return model, assumptions


# ─── Landing page ─────────────────────────────────────────────────────────────
def render_landing(model: str | None):
    # Hero
    st.markdown("""
    <div class="hero">
      <div class="hero-badge">◆ &nbsp;DCF · Monte Carlo · AI Scoring</div>
      <h1>Know what it's<br><span class="grad">really worth.</span></h1>
      <p>Institutional-grade valuation for any public company.
         Intrinsic value, financial health grade, and sentiment
         score — all from a single search.</p>
    </div>
    """, unsafe_allow_html=True)

    # Quick-access chips — wrapped for CSS targeting
    chips = [
        ("Apple",     "Apple Inc"),
        ("Tesla",     "Tesla"),
        ("Nvidia",    "Nvidia"),
        ("Microsoft", "Microsoft"),
        ("Amazon",    "Amazon"),
        ("Meta",      "Meta Platforms"),
    ]
    st.markdown('<div class="chip-row-wrap">', unsafe_allow_html=True)
    chip_cols = st.columns(len(chips))
    for i, (label, q) in enumerate(chips):
        with chip_cols[i]:
            if st.button(label, use_container_width=True, key=f"chip_{i}"):
                st.session_state.pending_query = q
                st.rerun()
    st.markdown('</div>', unsafe_allow_html=True)

    st.markdown('<div style="height:0.5rem"></div>', unsafe_allow_html=True)

    # Search form — input full width, CTA centred via CSS
    with st.form("search_form", clear_on_submit=False):
        query = st.text_input(
            "search",
            placeholder='Search by name, ticker, or ask — e.g. "Is Apple undervalued?" or "NVDA"',
            label_visibility="collapsed",
        )
        _, col_cta, _ = st.columns([2, 1.4, 2])
        with col_cta:
            submitted = st.form_submit_button(
                "🔍  Analyse", type="primary", use_container_width=True
            )

    # Handle pending (chip) query
    if st.session_state.pending_query:
        query = st.session_state.pending_query
        st.session_state.pending_query = None
        submitted = True

    if submitted and query:
        _run_search(query, model)

    # Show search results if cached
    if st.session_state.search_results and not st.session_state.selected_ticker:
        _show_search_results()
        return

    # Proof cards — only when no results pending
    if not st.session_state.search_results:
        st.markdown("""
<div class="proof-grid">
  <div class="proof-card">
    <div class="proof-icon proof-icon-dcf">📐</div>
    <div class="proof-title">3-Stage DCF + Monte Carlo</div>
    <div class="proof-body">
      Analyst-grade discounted cash flow model with high/base/low growth phases,
      WACC from first principles, and 1,000-run Monte Carlo simulation.
    </div>
    <div class="proof-pill-row">
      <span class="proof-pill proof-pill-v">Intrinsic Value</span>
      <span class="proof-pill proof-pill-v">Upside %</span>
      <span class="proof-pill proof-pill-v">Sensitivity Table</span>
    </div>
  </div>
  <div class="proof-card">
    <div class="proof-icon proof-icon-health">🩺</div>
    <div class="proof-title">Financial Health Score</div>
    <div class="proof-body">
      Composite grade (A–D) spanning solvency, profitability, and capital efficiency —
      Piotroski F-Score, Altman Z, ROIC, interest coverage, and more.
    </div>
    <div class="proof-pill-row">
      <span class="proof-pill proof-pill-g">Grade A–D</span>
      <span class="proof-pill proof-pill-g">Risk Level</span>
      <span class="proof-pill proof-pill-g">Ownership</span>
    </div>
  </div>
  <div class="proof-card">
    <div class="proof-icon proof-icon-hype">📡</div>
    <div class="proof-title">Market Sentiment & Hype</div>
    <div class="proof-body">
      Quantified momentum score from analyst consensus, short interest,
      insider moves, and 52-week price performance.
    </div>
    <div class="proof-pill-row">
      <span class="proof-pill proof-pill-a">Hype Score</span>
      <span class="proof-pill proof-pill-a">Analyst Feed</span>
      <span class="proof-pill proof-pill-a">Short Interest</span>
    </div>
  </div>
</div>
""", unsafe_allow_html=True)


def _run_search(query: str, model: str | None):
    """Process a search query: extract company, search YF, handle results."""
    query = query.strip()[:200]  # Sanitise: trim whitespace and cap length
    if not query:
        return
    if query == st.session_state.last_query and st.session_state.search_results:
        return

    st.session_state.last_query = query
    _clear_analysis()

    with st.spinner("Understanding your query…"):
        company = extract_company_from_query(query, model)

    with st.spinner(f"Searching for **{company}**…"):
        results = search_companies(company)

    if not results:
        st.error(f"No companies found for **{company}**. Try a different name or ticker.")
        return

    st.session_state.search_results = results

    # Auto-select if only one result or obvious ticker match
    if len(results) == 1:
        _select_company(results[0]["symbol"], results[0]["name"])
    else:
        # Check if any result exactly matches a ticker
        q_upper = query.strip().upper()
        for r in results:
            if r["symbol"] == q_upper:
                _select_company(r["symbol"], r["name"])
                return
        st.rerun()


def _show_search_results():
    st.markdown('<div class="sec">Search Results — select a company</div>',
                unsafe_allow_html=True)
    for r in st.session_state.search_results:
        col_info, col_btn = st.columns([5, 1])
        with col_info:
            st.markdown(
                f'<div class="suggestion">'
                f'<strong>{r["name"]}</strong> '
                f'<span style="color:#7c6cff; font-weight:600;">{r["symbol"]}</span> '
                f'<span style="color:#94a3b8; font-size:0.75rem;">· {r["exchange"]} · {r["type"]}</span>'
                f'</div>',
                unsafe_allow_html=True,
            )
        with col_btn:
            if st.button("Select →", key=f"sel_{r['symbol']}", use_container_width=True):
                _select_company(r["symbol"], r["name"])


def _select_company(ticker: str, name: str):
    st.session_state.selected_ticker = ticker
    st.session_state.selected_name   = name
    st.session_state.search_results  = []
    st.rerun()


def _clear_analysis():
    for k in ("stock_data","key_metrics","dcf_results","hype_data","confidence",
               "scores","ai_dcf","ai_news","ai_val","selected_ticker"):
        st.session_state[k] = None
    st.session_state.advanced_done = False


# ─── Top navigation bar for active analysis ───────────────────────────────────
def render_topbar():
    bc, rc = st.columns([6, 2])
    with bc:
        if st.button("← New Search", key="back"):
            _clear_analysis()
            st.session_state.last_query = ""
            st.session_state.search_results = []
            st.rerun()
    with rc:
        if st.button("↺  Re-analyse", key="reanalyse"):
            for k in ("stock_data","key_metrics","dcf_results","hype_data","confidence",
                      "ai_dcf","ai_news","ai_val","advanced_done"):
                st.session_state[k] = None
            st.rerun()


# ─── Verdict banner (verdict-first design) ────────────────────────────────────
def render_verdict_banner():
    dcf  = st.session_state.dcf_results
    conf = st.session_state.confidence
    sc   = st.session_state.scores or {}
    if not dcf:
        return

    iv     = dcf.get("intrinsic_value") or 0
    cp     = dcf.get("current_price")   or 0
    upside = dcf.get("upside_pct")      or 0
    mc     = dcf.get("monte_carlo")     or {}
    rank   = sc.get("rank", {})

    if upside > 15:
        gradient   = "linear-gradient(135deg,#064e3b 0%,#065f46 45%,#059669 100%)"
        shadow     = "rgba(5,150,105,0.40)"
        pill_bg    = "rgba(16,185,129,0.22)"
        pill_bd    = "rgba(16,185,129,0.45)"
        verdict    = "UNDERVALUED"
        verdict_sub = f"DCF suggests {upside:+.1f}% upside to fair value"
    elif upside < -15:
        gradient   = "linear-gradient(135deg,#7f1d1d 0%,#991b1b 45%,#dc2626 100%)"
        shadow     = "rgba(220,38,38,0.40)"
        pill_bg    = "rgba(239,68,68,0.22)"
        pill_bd    = "rgba(239,68,68,0.45)"
        verdict    = "OVERVALUED"
        verdict_sub = f"Market price appears {abs(upside):.1f}% above fair value"
    else:
        gradient   = "linear-gradient(135deg,#1e1b4b 0%,#312e81 45%,#4f46e5 100%)"
        shadow     = "rgba(99,102,241,0.40)"
        pill_bg    = "rgba(99,102,241,0.22)"
        pill_bd    = "rgba(99,102,241,0.45)"
        verdict    = "FAIRLY VALUED"
        verdict_sub = f"Intrinsic value and market price are closely aligned ({upside:+.1f}%)"

    # Confidence pill
    conf_score = conf["score"] if conf else "—"
    conf_level = conf["level"] if conf else "N/A"

    # Monte Carlo range
    p10 = mc.get("p10"); p90 = mc.get("p90")
    mc_str = f"${p10:.2f} – ${p90:.2f}" if (p10 and p90) else "N/A"

    # StockRank
    grade_str = f"Grade {rank['grade']}" if rank.get("grade") else ""

    st.markdown(
        f'<div class="verdict-banner" style="background:{gradient};'
        f'box-shadow:0 24px 64px {shadow};">'

        # ── Top row: verdict + confidence pill ──
        f'<div style="display:flex;justify-content:space-between;'
        f'align-items:flex-start;margin-bottom:1.6rem;gap:1.5rem;">'

        f'<div>'
        f'<div class="verdict-label">DCF Valuation Verdict</div>'
        f'<div class="verdict-word">{verdict}</div>'
        f'<div class="verdict-sub">{verdict_sub}</div>'
        f'</div>'

        f'<div style="display:flex;gap:0.75rem;flex-shrink:0;">'
        # Confidence pill
        f'<div class="verdict-pill" style="background:{pill_bg};border:1px solid {pill_bd};">'
        f'<div class="verdict-pill-lbl">Confidence</div>'
        f'<div class="verdict-pill-val">{conf_score}<span style="font-size:0.85rem;'
        f'font-weight:500;color:rgba(255,255,255,0.6)">/10</span></div>'
        f'<div class="verdict-pill-sub">{conf_level}</div>'
        f'</div>'
        + (
            f'<div class="verdict-pill" style="background:{pill_bg};border:1px solid {pill_bd};">'
            f'<div class="verdict-pill-lbl">StockRank</div>'
            f'<div class="verdict-pill-val">{rank.get("rank","—")}<span style="font-size:0.85rem;'
            f'font-weight:500;color:rgba(255,255,255,0.6)">/100</span></div>'
            f'<div class="verdict-pill-sub">{grade_str}</div>'
            f'</div>'
            if rank.get("rank") is not None else ""
        ) +

        f'</div>'  # end pills
        f'</div>'  # end top row

        # ── Bottom row: 4 stat boxes ──
        f'<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:0.85rem;">'

        f'<div class="verdict-stat">'
        f'<div class="verdict-stat-lbl">Intrinsic Value</div>'
        f'<div class="verdict-stat-val">${iv:.2f}</div>'
        f'<div class="verdict-stat-sub">DCF model</div>'
        f'</div>'

        f'<div class="verdict-stat">'
        f'<div class="verdict-stat-lbl">Market Price</div>'
        f'<div class="verdict-stat-val">${cp:.2f}</div>'
        f'<div class="verdict-stat-sub">Last close</div>'
        f'</div>'

        f'<div class="verdict-stat">'
        f'<div class="verdict-stat-lbl">Upside / Downside</div>'
        f'<div class="verdict-stat-val">{upside:+.1f}%</div>'
        f'<div class="verdict-stat-sub">vs fair value</div>'
        f'</div>'

        f'<div class="verdict-stat">'
        f'<div class="verdict-stat-lbl">Monte Carlo P10–P90</div>'
        f'<div class="verdict-stat-val" style="font-size:1.05rem;">{mc_str}</div>'
        f'<div class="verdict-stat-sub">1,500 simulations</div>'
        f'</div>'

        f'</div>'  # end stat grid
        f'</div>',  # end banner
        unsafe_allow_html=True,
    )


# ─── Load & cache company data ────────────────────────────────────────────────
def ensure_data(ticker: str, assumptions: dict):
    if st.session_state.stock_data is not None:
        return True

    with st.spinner(f"Loading data for **{ticker}** from Yahoo Finance…"):
        sd = get_comprehensive_data(ticker)

    if sd is None:
        st.error("Could not load data — try a different ticker or check your internet connection.")
        st.session_state.selected_ticker = None
        return False

    st.session_state.stock_data  = sd
    st.session_state.key_metrics = get_key_metrics(sd)

    with st.spinner("Running DCF model…"):
        dcf = run_dcf_model(sd, assumptions)

    with st.spinner("Running Monte Carlo & advanced valuation…"):
        dcf = enrich_with_advanced(dcf, sd)

    st.session_state.dcf_results  = dcf
    st.session_state.hype_data    = calculate_hype_score(sd)
    st.session_state.confidence   = calculate_confidence_score(dcf, st.session_state.key_metrics)

    # Scorecard calculations
    piot   = piotroski_f_score(sd)
    altman = altman_z_score(sd)
    pent   = calculate_pentagon(sd, dcf, st.session_state.key_metrics)
    hist_f = historical_financials(sd)
    rank   = stock_rank(pent)
    health = financial_health_score(sd, dcf, st.session_state.key_metrics)
    st.session_state.scores = {
        "piotroski": piot, "altman": altman,
        "pentagon": pent,  "history": hist_f,
        "rank": rank,      "health": health,
    }
    st.session_state.advanced_done = True
    return True


# ─── Overview ─────────────────────────────────────────────────────────────────
def _stat(lbl: str, val: str, color: str = "") -> str:
    """Build a single stat-strip cell."""
    style = f'style="color:{color};"' if color else ""
    return (
        f'<div class="stat-item">'
        f'<div class="stat-val" {style}>{val}</div>'
        f'<div class="stat-lbl">{lbl}</div>'
        f'</div>'
    )

def _sdiv() -> str:
    return '<div class="stat-div"></div>'


def _risk_badge_html() -> str:
    """Return inline HTML for risk level + health grade badges."""
    sc = st.session_state.scores or {}
    h  = sc.get("health", {})
    if not h:
        return ""

    rl   = h.get("risk_level", "")
    rc   = h.get("risk_color", "#94a3b8")
    grade = h.get("grade", "—")
    gc   = h.get("color", "#94a3b8")
    hs   = h.get("score", 0)

    # Risk badge background
    rgb = {"Low Risk": "52,211,153", "Medium Risk": "251,191,36",
           "High Risk": "251,113,133"}.get(rl, "148,163,184")

    return (
        f'<div class="badge-row">'
        f'<div class="risk-badge" style="background:rgba({rgb},0.12);'
        f'border:1px solid rgba({rgb},0.40);color:{rc};">'
        f'<span>●</span><span>{rl}</span>'
        f'</div>'
        f'<div class="health-badge" style="color:{gc};">'
        f'Health Grade <strong style="color:{gc};">{grade}</strong>'
        f' · {hs}/10'
        f'</div>'
        f'</div>'
    )


def render_overview():
    m    = st.session_state.key_metrics
    sd   = st.session_state.stock_data
    name = m.get("name", ""); ticker = m.get("ticker", "")
    cp   = m.get("current_price", 0); chg_pct = m.get("price_change_pct", 0)
    chg_arrow = "▲" if chg_pct >= 0 else "▼"
    chg_clr   = "var(--pos)" if chg_pct >= 0 else "var(--neg)"

    sector  = m.get("sector", ""); country = m.get("country", "")
    cap_str = fmt(m.get("market_cap"), "$") if m.get("market_cap") else ""
    rev_str = fmt(m.get("revenue"), "$") if m.get("revenue") else ""

    # ── Risk / health badges ─────────────────────────────────────────────────
    st.markdown(_risk_badge_html(), unsafe_allow_html=True)

    # ── Editorial price hero ─────────────────────────────────────────────────
    sub_parts = []
    if cap_str: sub_parts.append(f"Market cap {cap_str}")
    if rev_str:
        rev_g = m.get("revenue_growth")
        rev_tag = f" ({_pct(rev_g*100, sign=True)} YoY)" if rev_g else ""
        sub_parts.append(f"Revenue {rev_str}{rev_tag}")
    if m.get("exchange"): sub_parts.append(m["exchange"])

    st.markdown(
        f'<div class="price-hero">'
        f'<div class="price-hero-eyebrow">'
        f'<span class="tick">{ticker}</span>'
        f'{" · " + name if name else ""}'
        f'{" · " + sector if sector else ""}'
        f'{" · " + country if country else ""}'
        f'</div>'
        f'<div class="price-hero-row">'
        f'<div class="price-hero-num">${cp:,.2f}</div>'
        f'<div class="price-hero-chg" style="color:{chg_clr};">'
        f'{chg_arrow} {abs(chg_pct):.2f}%</div>'
        f'</div>'
        f'<div class="price-hero-sub">'
        + "  ·  ".join(sub_parts) +
        f'</div>'
        f'</div>',
        unsafe_allow_html=True,
    )

    # ── Horizontal stat strip ────────────────────────────────────────────────
    def _sv(v, fmt_fn=None, fallback="—"):
        if v is None: return fallback
        return fmt_fn(v) if fmt_fn else v

    ytd = m.get("ytd_return")
    ytd_clr = "var(--pos)" if (ytd or 0) > 0 else "var(--neg)"
    net_cash = (m.get("total_cash") or 0) - (m.get("total_debt") or 0)

    items = []
    items.append(_stat("P/E Trailing",
                       f'{m["pe_ratio"]:.1f}x' if m.get("pe_ratio") else "—"))
    items.append(_sdiv())
    items.append(_stat("P/E Forward",
                       f'{m["forward_pe"]:.1f}x' if m.get("forward_pe") else "—"))
    items.append(_sdiv())
    items.append(_stat("EV / EBITDA",
                       f'{m["ev_ebitda"]:.1f}x' if m.get("ev_ebitda") else "—"))
    items.append(_sdiv())
    items.append(_stat("Op. Margin",
                       _pct((m.get("operating_margin") or 0)*100, sign=False)))
    items.append(_sdiv())
    items.append(_stat("ROE",
                       _pct((m.get("roe") or 0)*100, sign=False)))
    items.append(_sdiv())
    items.append(_stat("Beta", f'{m.get("beta", 1):.2f}'))
    items.append(_sdiv())
    items.append(_stat("52-Wk Range",
                       f'${m.get("week_52_low",0):.0f}–${m.get("week_52_high",0):.0f}'))
    items.append(_sdiv())
    items.append(_stat("Net Cash / Debt", fmt(net_cash, "$")))
    items.append(_sdiv())
    if m.get("dividend_yield"):
        items.append(_stat("Dividend",
                           _pct(m["dividend_yield"]*100, sign=False)))
        items.append(_sdiv())
    items.append(_stat("1-Yr Return",
                       _pct(ytd, sign=True) if ytd is not None else "—",
                       ytd_clr if ytd is not None else ""))
    if m.get("recommendation"):
        items.append(_sdiv())
        items.append(_stat("Analyst Consensus",
                           (m.get("recommendation") or "—").title()))

    st.markdown(
        f'<div class="stat-strip">{"".join(items)}</div>',
        unsafe_allow_html=True,
    )

    # ── Price chart ──────────────────────────────────────────────────────────
    hist = sd.get("history_1y", pd.DataFrame())
    if not hist.empty:
        hist["MA50"]  = hist["Close"].rolling(50).mean()
        hist["MA200"] = hist["Close"].rolling(200).mean()

        fig = go.Figure()
        fig.add_trace(go.Scatter(
            x=hist.index, y=hist["Close"], name="Price",
            line=dict(color="#7c6cff", width=2.5),
            hovertemplate="<b>$%{y:.2f}</b><extra></extra>",
        ))
        fig.add_trace(go.Scatter(
            x=hist.index, y=hist["MA50"], name="50-day MA",
            line=dict(color="#f59e0b", width=1.5, dash="dot"),
        ))
        fig.add_trace(go.Scatter(
            x=hist.index, y=hist["MA200"], name="200-day MA",
            line=dict(color="#fb7185", width=1.5, dash="dot"),
        ))
        fig.add_trace(go.Bar(
            x=hist.index, y=hist["Volume"], name="Volume",
            yaxis="y2", marker_color="rgba(124,108,255,0.10)",
        ))
        fig.update_layout(
            yaxis2=dict(overlaying="y", side="right", showgrid=False,
                        tickformat=".2s", title="Volume"),
            plot_bgcolor="rgba(0,0,0,0)", paper_bgcolor="rgba(0,0,0,0)",
            legend=dict(orientation="h", y=1.08, x=0),
            margin=dict(l=0, r=0, t=30, b=0), height=300,
            hovermode="x unified",
        )
        st.plotly_chart(fig, use_container_width=True)

    if m.get("description"):
        with st.expander("About the company"):
            st.markdown(m["description"])


# ─── DCF tab ──────────────────────────────────────────────────────────────────
def render_dcf_tab(model: str | None):
    dcf  = st.session_state.dcf_results
    m    = st.session_state.key_metrics
    if not dcf: return

    iv     = dcf.get("intrinsic_value", 0)
    cp     = dcf.get("current_price", 0)
    upside = dcf.get("upside_pct", 0)
    wacc   = dcf.get("wacc_data", {}).get("wacc", 0)

    # ── Bento top numbers ────────────────────────────────────────────────────
    up_clr  = "#34d399" if upside > 0 else "#fb7185"
    tv_pct  = dcf.get("pv_terminal_pct", 0)
    ev_str  = fmt(dcf.get("enterprise_value"), "$") if dcf.get("enterprise_value") else "N/A"

    # Upside runway bar (capped ±60%)
    bar_pct = min(max((upside + 60) / 120 * 100, 0), 100)
    bar_clr = "#34d399" if upside > 0 else "#fb7185"

    st.markdown(
        f'<div class="bento bento-4">'

        # Hero cell — intrinsic value
        f'<div class="bento-cell bento-hero">'
        f'<div class="bento-lbl">DCF Intrinsic Value</div>'
        f'<div class="bento-val">{_price(iv) if iv else "N/A"}</div>'
        f'<div class="bento-sub">per share · discounted cash flow</div>'
        f'<div class="spark-bar"><div class="spark-fill" style="width:100%"></div></div>'
        f'</div>'

        # Upside cell
        f'<div class="bento-cell">'
        f'<div class="bento-lbl">Upside / Downside</div>'
        f'<div class="bento-val-sm" style="color:{up_clr};">{_pct(upside, sign=True)}</div>'
        f'<div class="bento-sub">vs ${cp:.2f} market price</div>'
        f'<div class="spark-bar"><div class="spark-fill" style="width:{bar_pct:.0f}%;'
        f'background:{bar_clr};"></div></div>'
        f'</div>'

        # WACC cell
        f'<div class="bento-cell">'
        f'<div class="bento-lbl">WACC</div>'
        f'<div class="bento-val-sm">{_pct(wacc*100, sign=False)}</div>'
        f'<div class="bento-sub">discount rate applied</div>'
        f'</div>'

        # Terminal value cell
        f'<div class="bento-cell">'
        f'<div class="bento-lbl">Terminal Value</div>'
        f'<div class="bento-val-sm">{tv_pct:.0f}% of EV</div>'
        f'<div class="bento-sub">{ev_str} enterprise value</div>'
        f'</div>'

        f'</div>',
        unsafe_allow_html=True,
    )

    for w in dcf.get("warnings", []):
        st.warning(f"⚠️  {w}")

    # ── Reverse DCF ─────────────────────────────────────────────────────────
    rev_g = dcf.get("reverse_dcf_growth")
    if rev_g is not None:
        mc    = dcf.get("monte_carlo")
        badge = f"<strong>{rev_g*100:.1f}%</strong> annual FCF growth"
        tone  = ("optimistic — market may expect high execution" if rev_g > 0.20
                 else ("reasonable for a mature company" if 0.05 < rev_g <= 0.20
                       else "conservative — or market is pricing in risk"))
        mc_extra = ""
        if mc:
            mc_extra = (
                f'<br><span style="font-size:0.8rem;color:#7c6cff;">'
                f'Monte Carlo P10/P50/P90: '
                f'${mc["p10"]:.2f} / ${mc["p50"]:.2f} / ${mc["p90"]:.2f}'
                f'</span>'
            )
        st.markdown(
            f'<div class="rdcf-box">'
            f'<span style="font-size:0.75rem;font-weight:600;color:#4f46e5;'
            f'text-transform:uppercase;letter-spacing:1px;">'
            f'Reverse DCF — Market-Implied Growth</span><br>'
            f'The current price of ${cp:.2f} implies {badge} '
            f'for the next 10 years — {tone}.{mc_extra}'
            f'</div>',
            unsafe_allow_html=True,
        )

    # ── FCF chart ───────────────────────────────────────────────────────────
    st.markdown('<div class="sec">Free Cash Flow: Historical vs 10-Year Projection</div>',
                unsafe_allow_html=True)

    h_fcf  = dcf.get("fcf_history", [])
    h_yrs  = dcf.get("fcf_years",   [])
    p_fcf  = dcf.get("projected_fcf", [])
    max_yr = max(h_yrs) if h_yrs else datetime.now().year
    p_yrs  = list(range(max_yr + 1, max_yr + 1 + len(p_fcf)))

    fig = go.Figure()
    if h_fcf and h_yrs:
        fig.add_trace(go.Bar(
            x=[str(y) for y in reversed(h_yrs)],
            y=[v/1e9 for v in reversed(h_fcf)],
            name="Historical FCF",
            marker_color=["#94a3b8" if v < 0 else "#7c6cff" for v in reversed(h_fcf)],
        ))
    if p_fcf:
        s1_end = 5
        fig.add_trace(go.Bar(
            x=[str(y) for y in p_yrs[:s1_end]],
            y=[v/1e9 for v in p_fcf[:s1_end]],
            name="Stage 1 (High Growth)",
            marker_color="#34d399", opacity=0.88,
        ))
        fig.add_trace(go.Bar(
            x=[str(y) for y in p_yrs[s1_end:]],
            y=[v/1e9 for v in p_fcf[s1_end:]],
            name="Stage 2 (Fade)",
            marker_color="#34d399", opacity=0.65,
        ))
    fig.update_layout(
        barmode="group", yaxis_title="FCF ($B)",
        plot_bgcolor="rgba(0,0,0,0)", paper_bgcolor="rgba(0,0,0,0)",
        legend=dict(orientation="h", y=1.08),
        margin=dict(l=0, r=0, t=20, b=0), height=280,
    )
    st.plotly_chart(fig, use_container_width=True)

    # ── Monte Carlo distribution ─────────────────────────────────────────────
    mc = dcf.get("monte_carlo")
    if mc and mc.get("data"):
        st.markdown('<div class="sec">Monte Carlo — Intrinsic Value Distribution (n=1,500)</div>',
                    unsafe_allow_html=True)
        data = np.array(mc["data"])
        fig2 = go.Figure()
        fig2.add_trace(go.Histogram(
            x=data, nbinsx=60,
            marker_color="#7c6cff", opacity=0.75, name="Simulations",
        ))
        for pct, lbl, col in [
            (mc["p10"],"P10","#fb7185"),
            (mc["p50"],"P50","#f59e0b"),
            (mc["p90"],"P90","#34d399"),
        ]:
            fig2.add_vline(x=pct, line_dash="dash", line_color=col, line_width=2,
                           annotation_text=f"{lbl} ${pct:.2f}", annotation_position="top")
        if cp:
            fig2.add_vline(x=cp, line_color="#e8edf7", line_width=2.5,
                           annotation_text=f"Market ${cp:.2f}", annotation_position="top left",
                           annotation_font_color="#e8edf7")
        fig2.update_layout(
            xaxis_title="Intrinsic Value per Share ($)",
            yaxis_title="Frequency",
            plot_bgcolor="rgba(0,0,0,0)", paper_bgcolor="rgba(0,0,0,0)",
            showlegend=False,
            margin=dict(l=0, r=0, t=30, b=0), height=270,
        )
        st.plotly_chart(fig2, use_container_width=True)
        mc_pairs = [
            ("P10 · Bear", mc["p10"], "var(--neg)"),
            ("P25",        mc["p25"], ""),
            ("P50 · Base", mc["p50"], "var(--accent)"),
            ("P75",        mc["p75"], ""),
            ("P90 · Bull", mc["p90"], "var(--pos)"),
        ]
        mc_cells = []
        for i, (l, v, clr) in enumerate(mc_pairs):
            if i: mc_cells.append(_sdiv())
            mc_cells.append(_stat(l, _price(v), clr))
        st.markdown(
            '<div class="stat-strip" style="border-top:none;padding-top:0;margin-top:-0.2rem;">'
            + "".join(mc_cells) + "</div>",
            unsafe_allow_html=True,
        )

    # ── WACC breakdown ───────────────────────────────────────────────────────
    wd = dcf.get("wacc_data", {})
    st.markdown('<div class="sec">WACC Breakdown</div>', unsafe_allow_html=True)

    wacc_items = [
        ("Beta",                    f'{wd.get("beta",1):.2f}'),
        ("Cost of Equity",          _pct(wd.get("cost_of_equity",0)*100, sign=False)),
        ("After-Tax Cost of Debt",  _pct(wd.get("after_tax_cost_of_debt",0)*100, sign=False)),
        ("Effective Tax Rate",      _pct(wd.get("tax_rate",0.21)*100, sign=False)),
        ("Debt / Total Capital",    _pct(wd.get("debt_weight",0)*100, sign=False)),
    ]
    wacc_cells = []
    for i, (l, v) in enumerate(wacc_items):
        if i: wacc_cells.append(_sdiv())
        wacc_cells.append(_stat(l, v))
    st.markdown(
        f'<div class="stat-strip" style="border:none;padding:0.6rem 0;margin:0 0 1rem;">'
        + "".join(wacc_cells) + "</div>",
        unsafe_allow_html=True,
    )

    # ── Sensitivity table ────────────────────────────────────────────────────
    st.markdown('<div class="sec">Sensitivity — Intrinsic Value per Share vs. WACC & Terminal Growth</div>',
                unsafe_allow_html=True)
    if dcf.get("shares_outstanding", 0) > 0:
        try:
            sens = sensitivity_table(dcf)
            def _hl(val):
                if val is None or not cp: return "background:rgba(148,163,184,0.06);color:#8a93a8"
                if val > cp * 1.20: return "background:rgba(52,211,153,0.28);color:#d1fae5"
                if val > cp * 1.05: return "background:rgba(56,189,248,0.22);color:#e0f2fe"
                if val < cp * 0.80: return "background:rgba(251,113,133,0.28);color:#fee2e2"
                if val < cp * 0.95: return "background:rgba(251,191,36,0.22);color:#fef9c3"
                return "background:rgba(52,211,153,0.12);color:#bbf7d0"
            st.dataframe(
                sens.style.map(_hl).format("${:.2f}", na_rep="—"),
                use_container_width=True,
            )
            st.caption(
                "🟢 >20% upside  🔵 5–20% upside  🟡 ±5% fairly valued  "
                "🟠 5–20% downside  🔴 >20% downside  "
                "| Rows = WACC ±2%, Columns = terminal growth rate"
            )
        except Exception as e:
            st.caption(f"Sensitivity table error: {e}")

    # ── AI narrative ─────────────────────────────────────────────────────────
    st.markdown('<div class="sec">AI-Generated DCF Report</div>', unsafe_allow_html=True)
    if model is None:
        st.info("Start Ollama and select a model in the sidebar to generate the AI analysis.")
    elif st.session_state.ai_dcf:
        st.markdown(f'<div class="glass">{st.session_state.ai_dcf}</div>',
                    unsafe_allow_html=True)
    else:
        if st.button("✨  Generate AI DCF Report", key="gen_dcf", type="primary"):
            chunks = []
            ph = st.empty()
            for c in generate_dcf_narrative(m, dcf, model):
                chunks.append(c)
                ph.markdown("".join(chunks))
            st.session_state.ai_dcf = "".join(chunks)
            st.rerun()


# ─── News tab ─────────────────────────────────────────────────────────────────
def render_news_tab(model: str | None):
    sd = st.session_state.stock_data
    m  = st.session_state.key_metrics
    if not sd: return

    news = sd.get("news", [])
    if not news:
        st.info("No recent news articles found.")
        return

    st.markdown(f'<div class="sec">Recent News ({len(news)} articles)</div>',
                unsafe_allow_html=True)
    for item in news:
        title = item.get("title","No title")
        pub   = item.get("publisher","")
        link  = item.get("link","#")
        ts    = item.get("providerPublishTime")
        date  = datetime.fromtimestamp(ts).strftime("%b %d, %Y") if ts else ""
        st.markdown(
            f'<div class="news-card">'
            f'<div class="news-title"><a href="{link}" target="_blank" '
            f'style="color:#1e293b;text-decoration:none;">{title}</a></div>'
            f'<div class="news-meta">{pub}  ·  {date}</div>'
            f'</div>', unsafe_allow_html=True)

    st.markdown('<div class="sec">AI News Sentiment Analysis</div>', unsafe_allow_html=True)
    if model is None:
        st.info("Start Ollama to generate sentiment analysis.")
    elif st.session_state.ai_news:
        st.markdown(f'<div class="glass">{st.session_state.ai_news}</div>',
                    unsafe_allow_html=True)
    else:
        if st.button("✨  Analyse News Sentiment", key="gen_news", type="primary"):
            chunks = []; ph = st.empty()
            for c in analyze_news_sentiment(news, m.get("name",""), model):
                chunks.append(c); ph.markdown("".join(chunks))
            st.session_state.ai_news = "".join(chunks)
            st.rerun()


# ─── Hype tab ─────────────────────────────────────────────────────────────────
def render_hype_tab():
    hype = st.session_state.hype_data
    m    = st.session_state.key_metrics
    if not hype: return

    score = hype["score"]; level = hype["level"]
    color = hype["color"]; emoji = hype["emoji"]

    g_col, d_col = st.columns([1, 1])
    with g_col:
        fig = go.Figure(go.Indicator(
            mode="gauge+number",
            value=score,
            number={"suffix":" / 100", "font":{"size":28,"color":"#e8edf7",
                                                "family":"Space Grotesk"}},
            gauge={
                "axis":{"range":[0,100],"tickwidth":1,"tickcolor":"#5a6379",
                        "tickfont":{"color":"#8a93a8"}},
                "bar":{"color":color,"thickness":0.32},
                "bgcolor":"rgba(0,0,0,0)","borderwidth":0,
                "steps":[
                    {"range":[0,20],"color":"rgba(56,189,248,0.10)"},
                    {"range":[20,40],"color":"rgba(52,211,153,0.10)"},
                    {"range":[40,60],"color":"rgba(251,191,36,0.12)"},
                    {"range":[60,80],"color":"rgba(249,115,22,0.14)"},
                    {"range":[80,100],"color":"rgba(251,113,133,0.16)"},
                ],
                "threshold":{"line":{"color":color,"width":4},"thickness":0.85,"value":score},
            },
            title={"text":f"{emoji}  Hype Meter","font":{"size":16,"color":"#8a93a8"}},
        ))
        fig.update_layout(height=290, margin=dict(l=5,r=5,t=40,b=5), paper_bgcolor="rgba(0,0,0,0)")
        st.plotly_chart(fig, use_container_width=True)
        st.markdown(f'<div style="text-align:center;font-size:1.25rem;font-weight:700;'
                    f'color:{color};">{level}</div>', unsafe_allow_html=True)

    with d_col:
        st.markdown('<div class="sec">Score Breakdown</div>', unsafe_allow_html=True)
        for label, comp in hype["components"].items():
            pct = comp["score"] / comp["max"] * 100
            bc  = "#34d399" if pct>=66 else ("#fbbf24" if pct>=33 else "#fb7185")
            st.markdown(
                f'<span style="color:#e8edf7;font-weight:600;font-size:0.88rem;">{label}</span> '
                f'<span style="color:#8a93a8;font-size:0.78rem;">{comp["detail"]}</span>'
                f'<div style="height:7px;background:rgba(148,163,184,0.14);border-radius:99px;'
                f'overflow:hidden;margin:5px 0 12px;">'
                f'<div style="width:{pct:.0f}%;height:100%;background:{bc};border-radius:99px;"></div></div>',
                unsafe_allow_html=True,
            )

    # Market data
    st.markdown('<div class="sec">Market Sentiment Data</div>', unsafe_allow_html=True)
    sent_cells = []
    sent_cells.append(_stat("Avg Daily Volume",
                            fmt(m.get("avg_volume")) if m.get("avg_volume") else "—"))
    sent_cells.append(_sdiv())
    sent_cells.append(_stat("Short Ratio",
                            f'{m["short_ratio"]:.1f} days' if m.get("short_ratio") else "—"))
    sent_cells.append(_sdiv())
    sent_cells.append(_stat("Short % Float",
                            _pct(m["short_percent"]*100, sign=False)
                            if m.get("short_percent") else "—"))
    sent_cells.append(_sdiv())
    sent_cells.append(_stat("Analyst Consensus",
                            (m.get("recommendation") or "—").title()))
    sent_cells.append(_sdiv())
    sent_cells.append(_stat("Analysts Covering",
                            str(m.get("analyst_count", "—"))))

    tgt_price = m.get("target_price")
    hype_cp   = m.get("current_price")
    if tgt_price and hype_cp:
        tgt_u = (tgt_price - hype_cp) / hype_cp * 100
        tgt_clr = "var(--pos)" if tgt_u > 0 else "var(--neg)"
        sent_cells.append(_sdiv())
        sent_cells.append(_stat("Analyst Target (Mean)",
                                f'{_price(tgt_price)} ({_pct(tgt_u, sign=True)})',
                                tgt_clr))
        if m.get("target_high"):
            sent_cells.append(_sdiv())
            sent_cells.append(_stat("Target High", _price(m["target_high"])))
        if m.get("target_low"):
            sent_cells.append(_sdiv())
            sent_cells.append(_stat("Target Low", _price(m["target_low"])))

    st.markdown(
        '<div class="stat-strip">' + "".join(sent_cells) + "</div>",
        unsafe_allow_html=True,
    )


# ─── Valuation tab ────────────────────────────────────────────────────────────
def render_valuation_tab(model: str | None):
    dcf  = st.session_state.dcf_results
    m    = st.session_state.key_metrics
    conf = st.session_state.confidence
    if not dcf: return

    iv     = dcf.get("intrinsic_value", 0)
    cp     = dcf.get("current_price", 0)
    upside = dcf.get("upside_pct", 0)
    mults  = dcf.get("multiples", {})

    # Status badge
    if upside > 15:
        bc, bt, bb, tc = "rgba(52,211,153,0.12)","🟢  Potentially Undervalued","rgba(52,211,153,0.45)","#6ee7b7"
    elif upside < -15:
        bc, bt, bb, tc = "rgba(251,113,133,0.12)","🔴  Potentially Overvalued","rgba(251,113,133,0.45)","#fda4af"
    else:
        bc, bt, bb, tc = "rgba(251,191,36,0.12)","🟡  Fairly Valued","rgba(251,191,36,0.45)","#fcd34d"
    st.markdown(
        f'<div class="val-badge" style="background:{bc};border:1px solid {bb};">'
        f'<span style="font-size:1.1rem;font-weight:700;color:{tc};">{bt}</span>'
        f'<span style="color:#c4cce0;font-size:0.9rem;">DCF: <strong style="color:#fff">${iv:.2f}</strong> '
        f'vs market: <strong style="color:#fff">${cp:.2f}</strong> ({upside:+.1f}%)</span></div>',
        unsafe_allow_html=True,
    )

    # Composite valuation chart
    st.markdown('<div class="sec">Valuation Comparison</div>', unsafe_allow_html=True)
    bars, bar_vals, bar_clrs = [], [], []

    def _bar(lbl, val, clr):
        if val and float(val) > 0:
            bars.append(lbl); bar_vals.append(float(val)); bar_clrs.append(clr)

    _bar("DCF Intrinsic Value",        iv,                          "#7c6cff")
    _bar("Market Price",               cp,                          "#cbd5e1")
    if mults.get("pe_value"):
        _bar(f'P/E ({mults["pe_multiple"]}x sector avg)',           mults["pe_value"],        "#f59e0b")
    if mults.get("ev_ebitda_value"):
        _bar(f'EV/EBITDA ({mults["ev_ebitda_multiple"]}x sector avg)', mults["ev_ebitda_value"], "#3b82f6")
    if mults.get("composite"):
        _bar("Multiples Composite",    mults["composite"],          "#8b5cf6")
    _bar("52-Wk High",                 m.get("week_52_high"),       "#94a3b8")
    _bar("52-Wk Low",                  m.get("week_52_low"),        "#cbd5e1")
    if m.get("target_price"):
        _bar("Analyst Target",         m["target_price"],           "#34d399")

    if bars:
        fig = go.Figure(go.Bar(
            x=bar_vals, y=bars, orientation="h",
            marker_color=bar_clrs,
            text=[f"${v:.2f}" for v in bar_vals], textposition="outside",
        ))
        fig.add_vline(x=cp, line_dash="dash", line_color="#e8edf7", line_width=2,
                      annotation_text="Market", annotation_position="top left",
                      annotation_font_color="#e8edf7")
        fig.update_layout(
            plot_bgcolor="rgba(0,0,0,0)", paper_bgcolor="rgba(0,0,0,0)",
            xaxis_title="Price ($)",
            margin=dict(l=0, r=80, t=10, b=0), height=max(240, len(bars)*42),
            showlegend=False,
        )
        st.plotly_chart(fig, use_container_width=True)

    # Confidence score
    if conf:
        st.markdown('<div class="sec">DCF Model Confidence Score</div>', unsafe_allow_html=True)
        sc_col, fc_col = st.columns([1, 2])
        with sc_col:
            fig_c = go.Figure(go.Indicator(
                mode="gauge+number",
                value=conf["score"],
                number={"suffix":" / 10","font":{"size":30,"color":conf["color"],
                                                  "family":"Space Grotesk"}},
                gauge={
                    "axis":{"range":[0,10],"tickcolor":"#5a6379",
                            "tickfont":{"color":"#8a93a8"}},
                    "bar":{"color":conf["color"],"thickness":0.38},
                    "bgcolor":"rgba(0,0,0,0)","borderwidth":0,
                    "steps":[
                        {"range":[0,4],"color":"rgba(251,113,133,0.16)"},
                        {"range":[4,6],"color":"rgba(249,115,22,0.14)"},
                        {"range":[6,8],"color":"rgba(251,191,36,0.12)"},
                        {"range":[8,10],"color":"rgba(52,211,153,0.14)"},
                    ],
                },
                title={"text":conf["level"],"font":{"size":15,"color":conf["color"]}},
            ))
            fig_c.update_layout(height=210, margin=dict(l=5,r=5,t=40,b=5), paper_bgcolor="rgba(0,0,0,0)")
            st.plotly_chart(fig_c, use_container_width=True)
        with fc_col:
            st.markdown("**Score drivers:**")
            icons = {"positive":"✅","neutral":"⚪","negative":"❌"}
            for kind, text in conf["factors"]:
                st.markdown(f'<div class="factor">{icons.get(kind,"•")} {text}</div>',
                            unsafe_allow_html=True)

    # ── Book value + ROIC cross-check ───────────────────────────────────────
    sc  = st.session_state.scores or {}
    hlth = sc.get("health", {})
    roic = hlth.get("roic"); fy = hlth.get("fcf_yield")
    bvps = m.get("book_value_per_share"); pb = m.get("pb_ratio")

    if roic is not None or fy is not None or bvps is not None:
        st.markdown('<div class="sec">Capital Efficiency Signals</div>',
                    unsafe_allow_html=True)
        eff_cells = []
        if roic is not None:
            wacc_val = dcf.get("wacc_data", {}).get("wacc", 0)
            spread   = (roic - wacc_val) * 100
            eff_cells.append(_stat("ROIC", f"{roic*100:.1f}%",
                                   "#34d399" if roic > 0.08 else "#fb7185"))
            eff_cells.append(_sdiv())
            eff_cells.append(_stat("ROIC–WACC Spread",
                                   f"{spread:+.1f}pts",
                                   "#34d399" if spread > 0 else "#fb7185"))
            eff_cells.append(_sdiv())
        if fy is not None:
            eff_cells.append(_stat("FCF Yield", f"{fy*100:.1f}%",
                                   "#34d399" if fy > 0.04 else "#fbbf24" if fy > 0 else "#fb7185"))
            eff_cells.append(_sdiv())
        if bvps is not None:
            eff_cells.append(_stat("Book Value / Share", _price(bvps)))
            if pb:
                eff_cells.append(_sdiv())
                eff_cells.append(_stat("Price / Book", f"{pb:.2f}×"))
        st.markdown(
            '<div class="stat-strip">' + "".join(eff_cells) + '</div>',
            unsafe_allow_html=True,
        )

    # AI gap analysis
    st.markdown('<div class="sec">AI: Why Does the Valuation Gap Exist?</div>',
                unsafe_allow_html=True)
    if model is None:
        st.info("Start Ollama to generate valuation gap analysis.")
    elif st.session_state.ai_val:
        st.markdown(f'<div class="glass">{st.session_state.ai_val}</div>',
                    unsafe_allow_html=True)
    else:
        if st.button("✨  Generate Valuation Analysis", key="gen_val", type="primary"):
            chunks = []; ph = st.empty()
            for c in analyze_valuation_gap(dcf, m, model):
                chunks.append(c); ph.markdown("".join(chunks))
            st.session_state.ai_val = "".join(chunks)
            st.rerun()


# ─── Scorecard tab ────────────────────────────────────────────────────────────
def render_scorecard_tab():
    sc = st.session_state.scores
    if not sc:
        return
    piot   = sc.get("piotroski", {})
    altman = sc.get("altman", {})
    pent   = sc.get("pentagon", {})
    hist_f = sc.get("history", {})
    rank   = sc.get("rank", {})

    # ── Pentagon Radar Chart ──────────────────────────────────────────────────
    st.markdown('<div class="sec">Health Pentagon — 5-Pillar Analysis</div>',
                unsafe_allow_html=True)
    cols_p = ["Value", "Growth", "Quality", "Momentum", "Income"]
    vals_p = [pent.get(k.lower(), 0) for k in cols_p]
    cols_p_closed = cols_p + [cols_p[0]]
    vals_p_closed = vals_p + [vals_p[0]]

    fig_radar = go.Figure()
    fig_radar.add_trace(go.Scatterpolar(
        r=vals_p_closed, theta=cols_p_closed, fill="toself",
        fillcolor="rgba(124,108,255,0.22)",
        line=dict(color="#7c6cff", width=2.5),
        marker=dict(size=7, color="#a855f7"),
        name="Score",
        hovertemplate="%{theta}: %{r}/6<extra></extra>",
    ))
    fig_radar.update_layout(
        polar=dict(
            radialaxis=dict(visible=True, range=[0, 6],
                           tickfont=dict(size=10, color="#8a93a8"), tickvals=[2, 4, 6],
                           gridcolor="rgba(148,163,184,0.14)",
                           linecolor="rgba(148,163,184,0.14)"),
            angularaxis=dict(tickfont=dict(size=12, color="#e8edf7"),
                            gridcolor="rgba(148,163,184,0.14)",
                            linecolor="rgba(148,163,184,0.14)"),
            bgcolor="rgba(17,22,42,0.5)",
        ),
        showlegend=False,
        paper_bgcolor="rgba(0,0,0,0)", plot_bgcolor="rgba(0,0,0,0)",
        margin=dict(l=40, r=40, t=20, b=20),
        height=340,
    )
    col_r, col_b = st.columns([3, 2])
    with col_r:
        st.plotly_chart(fig_radar, use_container_width=True)
    with col_b:
        st.markdown(f"""
        <div class="kpi" style="margin-bottom:10px">
          <div class="kpi-lbl">StockRank Score</div>
          <div class="kpi-val" style="font-size:2.4rem;color:{rank.get('color','#7c6cff')}">
            {rank.get('rank', 0)}<span style="font-size:1rem;color:#94a3b8">/100</span>
          </div>
          <div class="kpi-sub" style="color:{rank.get('color','#7c6cff')};font-weight:700">
            Grade {rank.get('grade','—')}  ·  Value+Growth+Quality
          </div>
        </div>""", unsafe_allow_html=True)
        for label, k in [("Value","value"),("Growth","growth"),
                         ("Quality","quality"),("Momentum","momentum"),("Income","income")]:
            v = pent.get(k, 0)
            pct = v / 6 * 100
            bar_color = "#34d399" if pct >= 67 else "#fbbf24" if pct >= 34 else "#fb7185"
            st.markdown(f"""
            <div style="margin-bottom:8px">
              <div style="display:flex;justify-content:space-between;font-size:0.76rem;
                          color:#8a93a8;margin-bottom:3px">
                <span>{label}</span><span style="font-weight:700;color:#e8edf7">{v}/6</span>
              </div>
              <div style="height:6px;background:rgba(148,163,184,0.14);border-radius:99px;overflow:hidden">
                <div style="width:{pct:.0f}%;height:100%;background:{bar_color};
                            border-radius:99px"></div>
              </div>
            </div>""", unsafe_allow_html=True)

    # ── Historical Financials ─────────────────────────────────────────────────
    if hist_f.get("years"):
        st.markdown('<div class="sec">5-Year Financial History</div>',
                    unsafe_allow_html=True)
        years_r = list(reversed(hist_f["years"]))
        fig_hist = go.Figure()
        fig_hist.add_trace(go.Bar(
            x=years_r, y=list(reversed(hist_f["revenue"])),
            name="Revenue", marker_color="#7c6cff", opacity=0.85))
        fig_hist.add_trace(go.Bar(
            x=years_r, y=list(reversed(hist_f["gross_profit"])),
            name="Gross Profit", marker_color="#22d3ee", opacity=0.85))
        fig_hist.add_trace(go.Bar(
            x=years_r, y=list(reversed(hist_f["fcf"])),
            name="Free Cash Flow", marker_color="#34d399", opacity=0.85))
        fig_hist.add_trace(go.Bar(
            x=years_r, y=list(reversed(hist_f["net_income"])),
            name="Net Income", marker_color="#f59e0b", opacity=0.85))
        fig_hist.update_layout(
            barmode="group",
            xaxis=dict(type="category"),
            yaxis=dict(ticksuffix="B", tickprefix="$"),
            plot_bgcolor="rgba(0,0,0,0)", paper_bgcolor="rgba(0,0,0,0)",
            legend=dict(orientation="h", y=1.08),
            margin=dict(l=0, r=0, t=30, b=0), height=300,
        )
        st.plotly_chart(fig_hist, use_container_width=True)

    # ── Piotroski F-Score ─────────────────────────────────────────────────────
    st.markdown('<div class="sec">Piotroski F-Score — Financial Quality (0–9)</div>',
                unsafe_allow_html=True)
    col_ps, col_pc = st.columns([1, 3])
    with col_ps:
        st.markdown(f"""
        <div class="kpi" style="text-align:center">
          <div class="kpi-lbl">F-Score</div>
          <div class="kpi-val" style="font-size:3rem;color:{piot.get('color','#888')}">
            {piot.get('score','—')}
          </div>
          <div class="kpi-sub" style="color:{piot.get('color','#888')};font-weight:700">
            {piot.get('grade','N/A')}<br>out of 9
          </div>
        </div>""", unsafe_allow_html=True)
    with col_pc:
        for (name, passed, detail) in piot.get("checks", []):
            if passed is True:
                icon, col = "✅", "#34d399"
            elif passed is False:
                icon, col = "❌", "#fb7185"
            else:
                icon, col = "⬜", "#94a3b8"
            st.markdown(
                f'<div style="display:flex;align-items:flex-start;gap:8px;'
                f'padding:6px 0;border-bottom:1px solid rgba(148,163,184,0.10);">'
                f'<span style="flex-shrink:0;font-size:0.9rem">{icon}</span>'
                f'<div><span style="font-size:0.83rem;font-weight:600;color:#e8edf7">{name}</span>'
                f'<br><span style="font-size:0.73rem;color:#8a93a8">{detail}</span></div>'
                f'</div>',
                unsafe_allow_html=True,
            )

    # ── Altman Z-Score ────────────────────────────────────────────────────────
    st.markdown('<div class="sec">Altman Z-Score — Bankruptcy Risk</div>',
                unsafe_allow_html=True)
    z = altman.get("score")
    z_zone  = altman.get("zone",  "Unavailable")
    z_color = altman.get("color", "#94a3b8")
    col_z1, col_z2, col_z3 = st.columns(3)
    with col_z1:
        st.markdown(f"""
        <div class="kpi">
          <div class="kpi-lbl">Z-Score</div>
          <div class="kpi-val" style="color:{z_color};font-size:2rem">
            {f"{z:.2f}" if z is not None else "N/A"}
          </div>
          <div class="kpi-sub" style="color:{z_color};font-weight:700">{z_zone}</div>
        </div>""", unsafe_allow_html=True)
    with col_z2:
        st.markdown("""
        <div class="kpi">
          <div class="kpi-lbl">Safe Zone</div>
          <div class="kpi-val" style="color:#34d399;font-size:1.1rem">Z &gt; 2.99</div>
          <div class="kpi-sub">Low bankruptcy risk</div>
        </div>
        <div class="kpi" style="margin-top:8px">
          <div class="kpi-lbl">Grey Zone</div>
          <div class="kpi-val" style="color:#fbbf24;font-size:1.1rem">1.81 – 2.99</div>
          <div class="kpi-sub">Uncertain territory</div>
        </div>""", unsafe_allow_html=True)
    with col_z3:
        if z is not None:
            factors = [
                ("Working Capital / Assets (X1)", altman.get("x1")),
                ("Retained Earnings / Assets (X2)", altman.get("x2")),
                ("EBIT / Assets (X3)",              altman.get("x3")),
                ("Market Cap / Liabilities (X4)",   altman.get("x4")),
                ("Revenue / Assets (X5)",            altman.get("x5")),
            ]
            for lbl, v_f in factors:
                st.markdown(
                    f'<div style="display:flex;justify-content:space-between;'
                    f'padding:5px 0;border-bottom:1px solid rgba(148,163,184,0.10);font-size:0.79rem">'
                    f'<span style="color:#8a93a8">{lbl}</span>'
                    f'<span style="font-weight:600;color:#e8edf7">{f"{v_f:.3f}" if v_f is not None else "—"}</span>'
                    f'</div>',
                    unsafe_allow_html=True,
                )


# ─── Financial Health tab ────────────────────────────────────────────────────
def render_health_tab():
    sc = st.session_state.scores or {}
    h  = sc.get("health", {})
    m  = st.session_state.key_metrics or {}
    dcf = st.session_state.dcf_results or {}
    sd  = st.session_state.stock_data or {}

    if not h:
        st.info("Run analysis first to see financial health data.")
        return

    # ── Header grade card ────────────────────────────────────────────────────
    grade = h.get("grade", "—"); gc = h.get("color", "#94a3b8")
    hs    = h.get("score", 0)
    rl    = h.get("risk_level", ""); rc = h.get("risk_color", "#94a3b8")
    roic  = h.get("roic"); fy = h.get("fcf_yield")
    ic    = h.get("interest_coverage"); nde = h.get("net_debt_ebitda")
    cr    = h.get("current_ratio"); qr = h.get("quick_ratio")

    st.markdown(
        f'<div style="background:linear-gradient(135deg,rgba(22,29,51,0.9),'
        f'rgba(17,22,42,0.9));border:1px solid var(--line);border-radius:20px;'
        f'padding:1.6rem 2rem;margin-bottom:1.5rem;display:flex;'
        f'align-items:center;gap:2rem;flex-wrap:wrap;">'

        # Grade circle
        f'<div style="text-align:center;min-width:100px;">'
        f'<div style="font-size:4rem;font-weight:800;color:{gc};'
        f'font-family:Space Grotesk,sans-serif;line-height:1;">{grade}</div>'
        f'<div style="font-size:0.62rem;font-weight:700;color:var(--faint);'
        f'text-transform:uppercase;letter-spacing:1.5px;margin-top:4px;">Health Grade</div>'
        f'<div style="font-size:0.8rem;color:{gc};font-weight:600;margin-top:2px;">'
        f'{hs}/10</div>'
        f'</div>'

        # Risk level
        f'<div style="flex:1;min-width:220px;">'
        f'<div style="font-size:0.62rem;font-weight:700;text-transform:uppercase;'
        f'letter-spacing:1.5px;color:var(--faint);margin-bottom:8px;">Risk Profile</div>'
        f'<div style="font-size:1.6rem;font-weight:700;color:{rc};'
        f'font-family:Space Grotesk,sans-serif;">{rl}</div>'
        f'<div style="font-size:0.78rem;color:var(--muted);margin-top:4px;">'
        f'Based on beta, leverage, interest coverage & Altman Z-Score</div>'
        f'</div>'

        f'</div>',
        unsafe_allow_html=True,
    )

    # ── Key metrics grid ─────────────────────────────────────────────────────
    st.markdown('<div class="sec">Key Health Metrics</div>', unsafe_allow_html=True)

    def _hcell(lbl: str, val: str, sub: str, color: str = "var(--ink)",
               tip: str = "") -> str:
        tip_html = f'<span class="tip" title="{tip}">?</span>' if tip else ""
        return (
            f'<div class="health-cell">'
            f'<div class="health-lbl">{lbl}{tip_html}</div>'
            f'<div class="health-val" style="color:{color};">{val}</div>'
            f'<div class="health-sub">{sub}</div>'
            f'</div>'
        )

    def _fmt_x(v, suffix="×"):
        if v is None: return "—"
        return f"{v:.2f}{suffix}"

    roic_color = "#34d399" if roic and roic > 0.08 else "#fbbf24" if roic and roic > 0 else "#fb7185"
    fy_color   = "#34d399" if fy   and fy   > 0.04 else "#fbbf24" if fy   and fy  > 0 else "#fb7185"
    ic_color   = "#34d399" if ic   and ic   > 5    else "#fbbf24" if ic   and ic  > 2 else "#fb7185"
    nde_color  = "#34d399" if nde  is not None and nde  < 2    else "#fbbf24" if nde  is not None and nde < 4 else "#fb7185"

    wacc_val = dcf.get("wacc_data", {}).get("wacc", 0)

    st.markdown(
        f'<div class="health-grid">'
        + _hcell("ROIC",
                 f"{roic*100:.1f}%" if roic is not None else "—",
                 f"WACC {wacc_val*100:.1f}% · spread {(roic-wacc_val)*100:.1f}pts"
                 if (roic and wacc_val) else "Return on Invested Capital",
                 roic_color,
                 "Return on Invested Capital: NOPAT / (Equity + Debt – Cash). Exceeding WACC means economic value creation.")
        + _hcell("FCF Yield",
                 f"{fy*100:.1f}%" if fy is not None else "—",
                 "Free cash flow / market cap",
                 fy_color,
                 "How much free cash flow the business generates per dollar of market cap. >4% is attractive for value investors.")
        + _hcell("Interest Coverage",
                 _fmt_x(ic),
                 "EBIT / interest expense",
                 ic_color,
                 "How many times EBIT can cover interest payments. >5× is healthy; <2× is risky.")
        + _hcell("Net Debt / EBITDA",
                 _fmt_x(nde),
                 "Negative = net cash position",
                 nde_color,
                 "Years of earnings needed to repay net debt. <2× is low leverage; >4× is high leverage.")
        + _hcell("Current Ratio",
                 _fmt_x(cr),
                 "Current assets / current liabilities",
                 "#34d399" if cr and cr > 1.5 else "#fbbf24" if cr and cr > 1 else "#fb7185",
                 "Short-term liquidity: >1.5× is healthy, <1× may signal cash flow pressure.")
        + _hcell("Quick Ratio",
                 _fmt_x(qr),
                 "Liquid assets / current liabilities",
                 "#34d399" if qr and qr > 1 else "#fbbf24" if qr and qr > 0.8 else "#fb7185",
                 "Like current ratio but excludes inventory. Shows ability to meet obligations without selling stock.")
        + f'</div>',
        unsafe_allow_html=True,
    )

    # ── Detailed checks ──────────────────────────────────────────────────────
    checks = h.get("checks", [])
    if checks:
        st.markdown('<div class="sec">Detailed Assessment</div>', unsafe_allow_html=True)
        icons = {"positive": "✅", "neutral": "⚪", "negative": "❌"}
        items_html = ""
        for (kind, lbl, detail) in checks:
            items_html += (
                f'<div class="check-item">'
                f'<div class="check-icon">{icons.get(kind,"•")}</div>'
                f'<div><div class="check-lbl">{lbl}</div>'
                f'<div class="check-detail">{detail}</div></div>'
                f'</div>'
            )
        st.markdown(
            f'<div style="background:linear-gradient(180deg,rgba(22,29,51,0.7),'
            f'rgba(17,22,42,0.7));border:1px solid var(--line);border-radius:16px;'
            f'padding:1.1rem 1.4rem;">{items_html}</div>',
            unsafe_allow_html=True,
        )

    # ── Ownership structure ──────────────────────────────────────────────────
    insider_pct  = m.get("insider_pct")
    inst_pct     = m.get("institution_pct")

    if insider_pct is not None or inst_pct is not None:
        st.markdown('<div class="sec">Ownership Structure</div>', unsafe_allow_html=True)
        own_cells = []
        if inst_pct is not None:
            own_cells.append(_stat("Institutional Ownership",
                                   f"{inst_pct*100:.1f}%",
                                   "#22d3ee"))
            own_cells.append(_sdiv())
        if insider_pct is not None:
            own_cells.append(_stat("Insider Ownership",
                                   f"{insider_pct*100:.1f}%",
                                   "#a855f7"))
            own_cells.append(_sdiv())
        if inst_pct and insider_pct:
            float_est = max(0, 1 - insider_pct - inst_pct)
            own_cells.append(_stat("Public Float (est.)", f"{float_est*100:.1f}%"))

        st.markdown(
            '<div class="stat-strip">' + "".join(own_cells) + '</div>',
            unsafe_allow_html=True,
        )

        # Ownership bar visualisation
        if insider_pct is not None and inst_pct is not None:
            float_pct = max(0, 1 - insider_pct - inst_pct)
            st.markdown(
                f'<div style="height:12px;border-radius:99px;overflow:hidden;'
                f'display:flex;margin-bottom:0.5rem;">'
                f'<div style="width:{inst_pct*100:.1f}%;background:#22d3ee;opacity:0.8;"'
                f' title="Institutional"></div>'
                f'<div style="width:{insider_pct*100:.1f}%;background:#a855f7;opacity:0.8;"'
                f' title="Insider"></div>'
                f'<div style="flex:1;background:rgba(148,163,184,0.18);"'
                f' title="Public Float"></div>'
                f'</div>'
                f'<div style="display:flex;gap:1.2rem;font-size:0.7rem;color:var(--faint);">'
                f'<span><span style="color:#22d3ee;">■</span> Institutional</span>'
                f'<span><span style="color:#a855f7;">■</span> Insider</span>'
                f'<span><span style="color:rgba(148,163,184,0.5);">■</span> Public Float</span>'
                f'</div>',
                unsafe_allow_html=True,
            )

        if insider_pct and insider_pct > 0.10:
            st.caption(f"ℹ️  {insider_pct*100:.0f}% insider ownership — management has strong skin in the game.")
        elif insider_pct and insider_pct < 0.01:
            st.caption("⚠️  Very low insider ownership — management incentives may not align with shareholders.")

    # ── Top institutional holders ────────────────────────────────────────────
    inst_df = sd.get("institutional_holders")
    if inst_df is not None and not inst_df.empty:
        st.markdown('<div class="sec">Top Institutional Holders</div>', unsafe_allow_html=True)
        try:
            cols_wanted = ["Holder", "Shares", "% Out", "Value"]
            available   = [c for c in cols_wanted if c in inst_df.columns]
            if available:
                show_df = inst_df[available].head(8).copy()
                if "% Out" in show_df.columns:
                    show_df["% Out"] = show_df["% Out"].apply(
                        lambda x: f"{float(x)*100:.2f}%" if x else "—"
                    )
                if "Value" in show_df.columns:
                    show_df["Value"] = show_df["Value"].apply(
                        lambda x: fmt(float(x), "$") if x else "—"
                    )
                st.dataframe(show_df, use_container_width=True, hide_index=True)
        except Exception:
            pass

    # ── Analyst recommendation history ───────────────────────────────────────
    rec_df = sd.get("recommendations")
    if rec_df is not None and not rec_df.empty:
        st.markdown('<div class="sec">Recent Analyst Activity</div>', unsafe_allow_html=True)
        try:
            # Newer yfinance returns columns: Firm, To Grade, From Grade, Action
            # Older: period-index with buy/hold/sell counts
            if "Firm" in rec_df.columns or "firm" in rec_df.columns:
                r = rec_df.copy()
                r.columns = [c.lower().replace(" ", "_") for c in r.columns]
                # Sort by date descending if index is DatetimeIndex
                if hasattr(r.index, "year"):
                    r = r.sort_index(ascending=False)
                r = r.head(12)
                items_html = ""
                for idx, row in r.iterrows():
                    firm  = row.get("firm", "—")
                    to_g  = row.get("to_grade", row.get("tograde", "—")) or "—"
                    frm_g = row.get("from_grade", row.get("fromgrade", "")) or ""
                    action = row.get("action", "") or ""
                    date_str = idx.strftime("%b %d, %Y") if hasattr(idx, "strftime") else str(idx)[:10]
                    grade_color = (
                        "#34d399" if any(w in to_g.lower() for w in ("buy","outperform","overweight","positive"))
                        else "#fb7185" if any(w in to_g.lower() for w in ("sell","underperform","underweight","negative"))
                        else "#fbbf24"
                    )
                    from_html = (
                        f'<span style="color:var(--faint);font-size:0.73rem;">'
                        f'from {frm_g}</span> ' if frm_g else ""
                    )
                    items_html += (
                        f'<div class="analyst-row">'
                        f'<div>'
                        f'<div style="font-weight:600;color:var(--ink);">{firm}</div>'
                        f'<div style="font-size:0.73rem;color:var(--faint);">{date_str}</div>'
                        f'</div>'
                        f'<div style="text-align:right;">'
                        f'{from_html}'
                        f'<span class="grade-pill" style="background:rgba(255,255,255,0.06);'
                        f'border:1px solid rgba(255,255,255,0.12);color:{grade_color};">'
                        f'{to_g}</span>'
                        f'</div>'
                        f'</div>'
                    )
                st.markdown(
                    f'<div style="background:linear-gradient(180deg,rgba(22,29,51,0.7),'
                    f'rgba(17,22,42,0.7));border:1px solid var(--line);border-radius:16px;'
                    f'padding:0.4rem 1.2rem;">{items_html}</div>',
                    unsafe_allow_html=True,
                )
            else:
                # Period-count format — show as summary
                recent = rec_df.tail(4)
                st.dataframe(recent, use_container_width=True)
        except Exception:
            st.caption("Analyst recommendation data not available in standard format for this ticker.")

    st.markdown(
        '<div style="margin-top:2rem;padding:1rem 1.2rem;border-radius:12px;'
        'background:rgba(251,191,36,0.07);border:1px solid rgba(251,191,36,0.22);'
        'font-size:0.77rem;color:#c4ac5a;">'
        '⚠️ Financial health metrics are computed from Yahoo Finance data and may differ from '
        'official filings. ROIC uses a simplified invested-capital definition. '
        'Non-US companies may have incomplete data for some metrics.'
        '</div>',
        unsafe_allow_html=True,
    )


# ─── Full analysis view ───────────────────────────────────────────────────────
def render_analysis(model: str | None, assumptions: dict):
    ticker = st.session_state.selected_ticker
    if not ensure_data(ticker, assumptions):
        return

    render_topbar()
    render_verdict_banner()
    render_overview()

    t1, t2, t3, t4, t5, t6 = st.tabs([
        "📐  DCF Analysis",
        "📰  News & Sentiment",
        "🌡️  Hype Meter",
        "⚖️  Valuation vs. Market",
        "🏆  Scorecard",
        "🩺  Financial Health",
    ])
    with t1: render_dcf_tab(model)
    with t2: render_news_tab(model)
    with t3: render_hype_tab()
    with t4: render_valuation_tab(model)
    with t5: render_scorecard_tab()
    with t6: render_health_tab()

    st.markdown(
        '<hr style="border:none;border-top:1px solid rgba(148,163,184,0.12);margin-top:2.5rem;">'
        '<p style="color:#5a6379;font-size:0.72rem;text-align:center;">'
        "⚠️  This tool is for educational purposes only and does not constitute financial advice. "
        "Always consult a qualified professional before making investment decisions. "
        "Financial data sourced from Yahoo Finance.</p>",
        unsafe_allow_html=True,
    )


# ─── Main ─────────────────────────────────────────────────────────────────────
def main():
    model, assumptions = render_sidebar()

    if st.session_state.selected_ticker:
        render_analysis(model, assumptions)
    else:
        render_landing(model)


if __name__ == "__main__":
    main()
