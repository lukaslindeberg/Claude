"""
Stock DCF Analyzer — Modern UI with smart natural-language search.
"""
import streamlit as st
import pandas as pd
import numpy as np
import plotly.graph_objects as go
import plotly.express as px
from datetime import datetime

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
)

# ─── Page config ──────────────────────────────────────────────────────────────
st.set_page_config(
    page_title="Stock DCF Analyzer",
    page_icon="📊",
    layout="wide",
    initial_sidebar_state="expanded",
)

# ─── Design tokens & CSS ──────────────────────────────────────────────────────
st.markdown("""
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');

/* ── Global ── */
*, *::before, *::after {
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif !important;
  box-sizing: border-box;
}
[data-testid="stAppViewContainer"] { background: #f0f4f8 !important; }
[data-testid="stHeader"] { display: none !important; }
[data-testid="stSidebar"] > div { background: #0f172a !important; }
[data-testid="stSidebar"] * { color: #cbd5e1 !important; }
[data-testid="stSidebar"] h2 { color: #64748b !important; font-size: 0.65rem !important;
  text-transform: uppercase; letter-spacing: 1.5px; }
[data-testid="stSidebar"] .stSuccess, [data-testid="stSidebar"] .stError,
[data-testid="stSidebar"] .stWarning, [data-testid="stSidebar"] .stInfo {
  border-radius: 8px !important; font-size: 0.8rem !important;
}
footer, #MainMenu { visibility: hidden !important; }

/* ── Hero section ── */
.hero {
  background: linear-gradient(135deg, #1e1b4b 0%, #312e81 45%, #4f46e5 80%, #6366f1 100%);
  border-radius: 20px; padding: 3.5rem 2rem 3rem; text-align: center;
  color: white; margin-bottom: 1.8rem;
  box-shadow: 0 20px 60px rgba(99,102,241,0.35);
}
.hero-badge {
  display: inline-block;
  background: rgba(255,255,255,0.12); border: 1px solid rgba(255,255,255,0.25);
  border-radius: 999px; padding: 5px 18px; font-size: 0.7rem; font-weight: 600;
  letter-spacing: 1.5px; text-transform: uppercase; margin-bottom: 1rem;
  color: rgba(255,255,255,0.9) !important;
}
.hero h1 {
  font-size: 2.8rem; font-weight: 800; margin: 0 0 0.6rem;
  letter-spacing: -0.5px; color: white !important;
}
.hero p { font-size: 1.05rem; color: rgba(255,255,255,0.75) !important; margin: 0; }

/* ── KPI cards ── */
.kpi {
  background: white; border-radius: 14px; padding: 1.1rem 1.3rem;
  box-shadow: 0 2px 16px rgba(15,23,42,0.07);
  border: 1px solid #f1f5f9;
  transition: box-shadow 0.2s, transform 0.2s;
  height: 100%;
}
.kpi:hover { box-shadow: 0 8px 28px rgba(15,23,42,0.13); transform: translateY(-2px); }
.kpi-lbl { font-size: 0.67rem; font-weight: 600; color: #94a3b8;
  text-transform: uppercase; letter-spacing: 0.9px; margin-bottom: 5px; }
.kpi-val { font-size: 1.45rem; font-weight: 700; color: #0f172a; line-height: 1.1; }
.kpi-sub { font-size: 0.78rem; color: #64748b; margin-top: 4px; font-weight: 500; }
.green  { color: #10b981 !important; }
.red    { color: #ef4444 !important; }
.amber  { color: #f59e0b !important; }
.indigo { color: #6366f1 !important; }

/* ── Section headers ── */
.sec {
  font-size: 1.05rem; font-weight: 700; color: #1e293b;
  border-left: 4px solid #6366f1; padding-left: 10px;
  margin: 1.5rem 0 0.9rem;
}

/* ── Glass panel (AI boxes, news) ── */
.glass {
  background: rgba(255,255,255,0.95);
  backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(255,255,255,0.8);
  border-radius: 14px; padding: 1.4rem 1.6rem;
  box-shadow: 0 4px 24px rgba(15,23,42,0.08);
  line-height: 1.75; color: #1e293b;
}

/* ── Valuation badge ── */
.val-badge {
  border-radius: 12px; padding: 1rem 1.4rem; margin-bottom: 1rem;
  display: flex; align-items: center; gap: 1rem;
}

/* ── News cards ── */
.news-card {
  background: white; border-radius: 10px; padding: 0.9rem 1.1rem;
  margin-bottom: 0.6rem; border-left: 3px solid #6366f1;
  box-shadow: 0 1px 6px rgba(15,23,42,0.06);
}
.news-title { font-weight: 600; color: #1e293b; font-size: 0.88rem; }
.news-meta  { font-size: 0.73rem; color: #94a3b8; margin-top: 3px; }

/* ── Chip buttons ── */
div[data-testid="stButton"] > button {
  border-radius: 999px !important;
  font-size: 0.83rem !important;
  font-weight: 500 !important;
  transition: all 0.15s !important;
}
div[data-testid="stButton"] > button[kind="primary"] {
  background: linear-gradient(135deg, #6366f1, #4f46e5) !important;
  border: none !important; color: white !important;
  box-shadow: 0 4px 14px rgba(99,102,241,0.4) !important;
}
div[data-testid="stButton"] > button[kind="primary"]:hover {
  box-shadow: 0 6px 20px rgba(99,102,241,0.55) !important;
  transform: translateY(-1px) !important;
}

/* ── Tabs ── */
.stTabs [data-baseweb="tab-list"] { gap: 4px; background: transparent; }
.stTabs [data-baseweb="tab"] {
  border-radius: 8px 8px 0 0; font-weight: 500;
  font-size: 0.85rem !important;
}

/* ── Confidence factor list ── */
.factor { padding: 3px 0; font-size: 0.82rem; color: #374151; }

/* ── Search suggestions ── */
.suggestion {
  background: white; border-radius: 8px; padding: 0.6rem 1rem;
  border: 1px solid #e2e8f0; cursor: pointer; font-size: 0.85rem;
  margin-bottom: 4px; color: #1e293b;
  transition: background 0.15s;
}
.suggestion:hover { background: #f0f4ff; border-color: #6366f1; }

/* ── Reverse DCF highlight ── */
.rdcf-box {
  background: linear-gradient(135deg, #ede9fe, #e0e7ff);
  border: 1px solid #c7d2fe; border-radius: 12px;
  padding: 1rem 1.3rem; margin-bottom: 1rem;
}

/* ── Verdict banner ── */
.verdict-banner {
  border-radius: 20px; padding: 2.2rem 2.4rem 2rem;
  margin-bottom: 1.6rem; color: white;
  position: relative; overflow: hidden;
}
.verdict-banner::before {
  content: ""; position: absolute; inset: 0;
  background: radial-gradient(ellipse at 80% 0%, rgba(255,255,255,0.08) 0%, transparent 70%);
  pointer-events: none;
}
.verdict-label {
  font-size: 0.62rem; font-weight: 700; letter-spacing: 2.5px;
  text-transform: uppercase; color: rgba(255,255,255,0.55); margin-bottom: 5px;
}
.verdict-word {
  font-size: 3.2rem; font-weight: 900; letter-spacing: -1.5px; line-height: 1;
  color: white !important;
}
.verdict-sub {
  font-size: 1rem; color: rgba(255,255,255,0.75); margin-top: 6px; font-weight: 500;
}
.verdict-pill {
  border-radius: 12px; padding: 0.8rem 1.2rem;
  text-align: center; backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px); min-width: 110px;
}
.verdict-pill-lbl {
  font-size: 0.58rem; font-weight: 700; letter-spacing: 1.5px;
  text-transform: uppercase; color: rgba(255,255,255,0.6); margin-bottom: 3px;
}
.verdict-pill-val {
  font-size: 1.55rem; font-weight: 800; color: white; line-height: 1.1;
}
.verdict-pill-sub {
  font-size: 0.68rem; color: rgba(255,255,255,0.65); margin-top: 2px;
}
.verdict-stat {
  background: rgba(0,0,0,0.22); border-radius: 12px;
  padding: 0.85rem 1rem; min-width: 0;
}
.verdict-stat-lbl {
  font-size: 0.58rem; font-weight: 700; text-transform: uppercase;
  letter-spacing: 1.2px; color: rgba(255,255,255,0.5); margin-bottom: 4px;
}
.verdict-stat-val {
  font-size: 1.35rem; font-weight: 800; color: white; line-height: 1.1;
}
.verdict-stat-sub {
  font-size: 0.68rem; color: rgba(255,255,255,0.6); margin-top: 2px;
}
</style>
""", unsafe_allow_html=True)


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
    return f"${v:.{d}f}" if v else "N/A"

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
        st.markdown("## 📊 DCF Analyzer")
        st.markdown("---")
        st.markdown("### AI ENGINE")

        ollama_ok = check_ollama_status()
        if ollama_ok:
            st.success("Ollama running ✓")
            models = get_available_models()
            if models:
                model = st.selectbox("Model", models)
            else:
                st.warning("No models.\nRun: `ollama pull llama3.2`")
                model = None
        else:
            st.error("Ollama not detected.\n\n"
                     "**Install:** ollama.ai\n"
                     "**Start:** `ollama serve`\n"
                     "**Model:** `ollama pull llama3.2`")
            model = None

        st.markdown("---")

        with st.expander("⚙️  DCF Assumptions", expanded=False):
            # Preset buttons
            st.markdown(
                '<div style="font-size:0.65rem;font-weight:700;text-transform:uppercase;'
                'letter-spacing:1.5px;color:#64748b;margin-bottom:8px;">Scenario Presets</div>',
                unsafe_allow_html=True,
            )
            c1, c2, c3 = st.columns(3)
            preset = None
            with c1:
                if st.button("🐻 Bear", use_container_width=True):  preset = "bear"
            with c2:
                if st.button("📊 Base", use_container_width=True):  preset = "base"
            with c3:
                if st.button("🐂 Bull", use_container_width=True):  preset = "bull"

            if preset == "bear":
                st.session_state["_preset"] = {"rf": 5.0, "mrp": 6.5, "tg": 1.5, "ga": -5.0}
            elif preset == "base":
                st.session_state["_preset"] = {"rf": 4.5, "mrp": 5.5, "tg": 2.5, "ga":  0.0}
            elif preset == "bull":
                st.session_state["_preset"] = {"rf": 3.5, "mrp": 4.5, "tg": 3.5, "ga":  5.0}
            p = st.session_state.get("_preset", {})

            st.markdown(
                '<div style="font-size:0.65rem;font-weight:700;text-transform:uppercase;'
                'letter-spacing:1.5px;color:#64748b;margin:12px 0 6px;">Parameters</div>',
                unsafe_allow_html=True,
            )
            rf  = st.slider("Risk-Free Rate (%)",      1.0, 8.0, p.get("rf",  4.5), 0.1) / 100
            mrp = st.slider("Market Risk Premium (%)",  3.0, 9.0, p.get("mrp", 5.5), 0.1) / 100
            tg  = st.slider("Terminal Growth (%)",      0.5, 5.0, p.get("tg",  2.5), 0.1) / 100
            ga  = st.slider("Growth Adjustment (%)", -15.0,15.0, p.get("ga",  0.0), 0.5) / 100

        assumptions = {
            "risk_free_rate": rf, "market_risk_premium": mrp,
            "terminal_growth": tg, "growth_adjustment": ga,
            "projection_years": 5,
        }

        st.markdown("---")
        st.caption("Data: Yahoo Finance · AI: Ollama")
        st.caption("⚠️ Educational only — not financial advice.")

    return model, assumptions


# ─── Landing page ─────────────────────────────────────────────────────────────
def render_landing(model: str | None):
    # Hero
    st.markdown("""
    <div class="hero">
      <div class="hero-badge">AI · Local · Free · No subscription</div>
      <h1>Stock DCF Analyzer</h1>
      <p>Professional intrinsic-value analysis running entirely on your machine.<br>
         Ask anything — it understands natural language.</p>
    </div>
    """, unsafe_allow_html=True)

    # Quick-access chips
    chips = [
        ("Apple",     "Apple Inc"),
        ("Tesla",     "Tesla"),
        ("Nvidia",    "Nvidia"),
        ("Microsoft", "Microsoft"),
        ("Amazon",    "Amazon"),
        ("Meta",      "Meta Platforms"),
    ]
    chip_cols = st.columns(len(chips))
    for i, (label, q) in enumerate(chips):
        with chip_cols[i]:
            if st.button(label, use_container_width=True, key=f"chip_{i}"):
                st.session_state.pending_query = q
                st.rerun()

    st.markdown("")

    # Search form
    with st.form("search_form", clear_on_submit=False):
        query = st.text_input(
            "search",
            placeholder='Search by name, ticker, or ask — e.g. "Is Apple undervalued?" or "NVDA"',
            label_visibility="collapsed",
        )
        submitted = st.form_submit_button(
            "🔍  Analyse", use_container_width=True, type="primary"
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


def _run_search(query: str, model: str | None):
    """Process a search query: extract company, search YF, handle results."""
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
                f'<span style="color:#6366f1; font-weight:600;">{r["symbol"]}</span> '
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
               "scores","ai_dcf","ai_news","ai_val","advanced_done","selected_ticker"):
        st.session_state[k] = None
    st.session_state.advanced_done = False


# ─── Top navigation bar for active analysis ───────────────────────────────────
def render_topbar(model: str | None):
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
    st.session_state.scores = {
        "piotroski": piot, "altman": altman,
        "pentagon": pent, "history": hist_f, "rank": rank,
    }
    st.session_state.advanced_done = True
    return True


# ─── Overview ─────────────────────────────────────────────────────────────────
def render_overview():
    m    = st.session_state.key_metrics
    sd   = st.session_state.stock_data
    name = m.get("name",""); ticker = m.get("ticker","")
    cp   = m.get("current_price", 0); chg_pct = m.get("price_change_pct", 0)
    arrow = "▲" if chg_pct >= 0 else "▼"; clr = "green" if chg_pct >= 0 else "red"

    st.markdown(
        f'<h2 style="margin-bottom:2px;color:#0f172a;font-weight:800;">{name} '
        f'<span style="color:#6366f1;font-size:1.1rem;font-weight:600;">({ticker})</span></h2>'
        f'<p style="color:#64748b;margin:0 0 1rem;">'
        f'{m.get("sector","N/A")} · {m.get("industry","N/A")} · {m.get("country","")}</p>',
        unsafe_allow_html=True,
    )

    # Row 1 — price & scale
    c = st.columns(6)
    with c[0]: _kpi("Current Price",   f"${cp:.2f}",
                    f'{arrow} {abs(chg_pct):.2f}% today', clr)
    with c[1]: _kpi("Market Cap",      fmt(m.get("market_cap"),"$"))
    with c[2]: _kpi("Revenue (TTM)",   fmt(m.get("revenue"),"$"),
                    _pct((m.get("revenue_growth") or 0)*100, sign=True)+" YoY"
                    if m.get("revenue_growth") else None)
    with c[3]: _kpi("P/E (trail/fwd)",
                    f'{m["pe_ratio"]:.1f}x' if m.get("pe_ratio") else "N/A",
                    f'Fwd {m["forward_pe"]:.1f}x' if m.get("forward_pe") else None)
    with c[4]: _kpi("52-Wk Range",
                    f'${m.get("week_52_low",0):.0f} – ${m.get("week_52_high",0):.0f}')
    with c[5]: _kpi("Beta",            f'{m.get("beta",1):.2f}', "vs S&P 500")

    # Row 2 — profitability & capital
    c = st.columns(6)
    with c[0]: _kpi("Op. Margin",      _pct((m.get("operating_margin") or 0)*100, sign=False))
    with c[1]: _kpi("EV / EBITDA",     f'{m["ev_ebitda"]:.1f}x' if m.get("ev_ebitda") else "N/A")
    with c[2]: _kpi("ROE",             _pct((m.get("roe") or 0)*100, sign=False))
    with c[3]: _kpi("Net Cash / Debt",
                    fmt((m.get("total_cash") or 0) - (m.get("total_debt") or 0),"$"))
    with c[4]: _kpi("Dividend Yield",
                    _pct((m.get("dividend_yield") or 0)*100, sign=False)
                    if m.get("dividend_yield") else "—")
    with c[5]: _kpi("1-Year Return",
                    _pct(m.get("ytd_return"), sign=True) if m.get("ytd_return") is not None else "N/A",
                    sub_cls=_cc(m.get("ytd_return")))

    # Price chart
    hist = sd.get("history_1y", pd.DataFrame())
    if not hist.empty:
        hist["MA50"]  = hist["Close"].rolling(50).mean()
        hist["MA200"] = hist["Close"].rolling(200).mean()

        fig = go.Figure()
        fig.add_trace(go.Scatter(x=hist.index, y=hist["Close"], name="Price",
            line=dict(color="#6366f1", width=2.5),
            hovertemplate="<b>$%{y:.2f}</b><extra></extra>"))
        fig.add_trace(go.Scatter(x=hist.index, y=hist["MA50"], name="50-day MA",
            line=dict(color="#f59e0b", width=1.5, dash="dot")))
        fig.add_trace(go.Scatter(x=hist.index, y=hist["MA200"], name="200-day MA",
            line=dict(color="#ef4444", width=1.5, dash="dot")))
        fig.add_trace(go.Bar(x=hist.index, y=hist["Volume"], name="Volume",
            yaxis="y2", marker_color="rgba(99,102,241,0.12)"))
        fig.update_layout(
            yaxis2=dict(overlaying="y", side="right", showgrid=False,
                        tickformat=".2s", title="Volume"),
            plot_bgcolor="white", paper_bgcolor="white",
            legend=dict(orientation="h", y=1.08, x=0),
            margin=dict(l=0, r=0, t=30, b=0), height=310,
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

    # ── Top KPIs ────────────────────────────────────────────────────────────
    c = st.columns(5)
    with c[0]: _kpi("DCF Intrinsic Value", _price(iv) if iv else "N/A")
    with c[1]: _kpi("Upside / Downside",   _pct(upside, sign=True),
                     sub_cls=_cc(upside))
    with c[2]: _kpi("WACC",               _pct(wacc*100, sign=False))
    with c[3]: _kpi("Enterprise Value",   fmt(dcf.get("enterprise_value"),"$"))
    with c[4]: _kpi("Terminal Value %",   f'{dcf.get("pv_terminal_pct",0):.0f}% of EV')

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
                f'<br><span style="font-size:0.8rem;color:#6366f1;">'
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
            marker_color=["#94a3b8" if v < 0 else "#6366f1" for v in reversed(h_fcf)],
        ))
    if p_fcf:
        s1_end = 5
        fig.add_trace(go.Bar(
            x=[str(y) for y in p_yrs[:s1_end]],
            y=[v/1e9 for v in p_fcf[:s1_end]],
            name="Stage 1 (High Growth)",
            marker_color="#10b981", opacity=0.88,
        ))
        fig.add_trace(go.Bar(
            x=[str(y) for y in p_yrs[s1_end:]],
            y=[v/1e9 for v in p_fcf[s1_end:]],
            name="Stage 2 (Fade)",
            marker_color="#34d399", opacity=0.65,
        ))
    fig.update_layout(
        barmode="group", yaxis_title="FCF ($B)",
        plot_bgcolor="white", paper_bgcolor="white",
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
            marker_color="#6366f1", opacity=0.75, name="Simulations",
        ))
        for pct, lbl, col in [
            (mc["p10"],"P10","#ef4444"),
            (mc["p50"],"P50","#f59e0b"),
            (mc["p90"],"P90","#10b981"),
        ]:
            fig2.add_vline(x=pct, line_dash="dash", line_color=col, line_width=2,
                           annotation_text=f"{lbl} ${pct:.2f}", annotation_position="top")
        if cp:
            fig2.add_vline(x=cp, line_color="#0f172a", line_width=2.5,
                           annotation_text=f"Market ${cp:.2f}", annotation_position="top left")
        fig2.update_layout(
            xaxis_title="Intrinsic Value per Share ($)",
            yaxis_title="Frequency",
            plot_bgcolor="white", paper_bgcolor="white",
            showlegend=False,
            margin=dict(l=0, r=0, t=30, b=0), height=270,
        )
        st.plotly_chart(fig2, use_container_width=True)
        mc_cols = st.columns(5)
        for col, (lbl, val) in zip(mc_cols, [
            ("P10 (Bear)", mc["p10"]),  ("P25", mc["p25"]),
            ("P50 (Base)", mc["p50"]),  ("P75", mc["p75"]),
            ("P90 (Bull)", mc["p90"]),
        ]):
            with col: _kpi(lbl, _price(val))

    # ── WACC breakdown ───────────────────────────────────────────────────────
    wd = dcf.get("wacc_data", {})
    st.markdown('<div class="sec">WACC Breakdown</div>', unsafe_allow_html=True)
    wc = st.columns(5)
    with wc[0]: _kpi("Beta",                   f'{wd.get("beta",1):.2f}')
    with wc[1]: _kpi("Cost of Equity",         _pct(wd.get("cost_of_equity",0)*100, sign=False))
    with wc[2]: _kpi("Cost of Debt (post-tax)",_pct(wd.get("after_tax_cost_of_debt",0)*100, sign=False))
    with wc[3]: _kpi("Effective Tax Rate",     _pct(wd.get("tax_rate",0.21)*100, sign=False))
    with wc[4]: _kpi("Debt / Total Capital",   _pct(wd.get("debt_weight",0)*100, sign=False))

    # ── Sensitivity table ────────────────────────────────────────────────────
    st.markdown('<div class="sec">Sensitivity — Intrinsic Value per Share vs. WACC & Terminal Growth</div>',
                unsafe_allow_html=True)
    if dcf.get("shares_outstanding", 0) > 0:
        try:
            sens = sensitivity_table(dcf)
            def _hl(val):
                if val is None or not cp: return "background:#f8fafc"
                if val > cp * 1.20: return "background:#d1fae5;color:#065f46"
                if val > cp * 1.05: return "background:#e0f2fe;color:#0c4a6e"
                if val < cp * 0.80: return "background:#fee2e2;color:#991b1b"
                if val < cp * 0.95: return "background:#fef9c3;color:#92400e"
                return "background:#f0fdf4;color:#166534"
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
            number={"suffix":" / 100", "font":{"size":26,"color":"#0f172a"}},
            gauge={
                "axis":{"range":[0,100],"tickwidth":1,"tickcolor":"#94a3b8"},
                "bar":{"color":color,"thickness":0.32},
                "bgcolor":"white","borderwidth":0,
                "steps":[
                    {"range":[0,20],"color":"#f1f5f9"},
                    {"range":[20,40],"color":"#dbeafe"},
                    {"range":[40,60],"color":"#fef9c3"},
                    {"range":[60,80],"color":"#ffedd5"},
                    {"range":[80,100],"color":"#fee2e2"},
                ],
                "threshold":{"line":{"color":color,"width":4},"thickness":0.85,"value":score},
            },
            title={"text":f"{emoji}  Hype Meter","font":{"size":17}},
        ))
        fig.update_layout(height=290, margin=dict(l=5,r=5,t=40,b=5), paper_bgcolor="white")
        st.plotly_chart(fig, use_container_width=True)
        st.markdown(f'<div style="text-align:center;font-size:1.25rem;font-weight:700;'
                    f'color:{color};">{level}</div>', unsafe_allow_html=True)

    with d_col:
        st.markdown('<div class="sec">Score Breakdown</div>', unsafe_allow_html=True)
        for label, comp in hype["components"].items():
            pct = comp["score"] / comp["max"] * 100
            bc  = "#10b981" if pct>=66 else ("#f59e0b" if pct>=33 else "#ef4444")
            st.markdown(
                f'**{label}** — <span style="color:#64748b;font-size:0.8rem;">{comp["detail"]}</span><br>'
                f'<div style="height:7px;background:#f1f5f9;border-radius:4px;overflow:hidden;margin:3px 0 10px;">'
                f'<div style="width:{pct:.0f}%;height:100%;background:{bc};border-radius:4px;"></div></div>',
                unsafe_allow_html=True,
            )

    # Market data
    st.markdown('<div class="sec">Market Sentiment Data</div>', unsafe_allow_html=True)
    sc = st.columns(4)
    with sc[0]: _kpi("Avg Daily Volume", fmt(m.get("avg_volume")))
    with sc[1]: _kpi("Short Ratio", f'{m["short_ratio"]:.1f} days' if m.get("short_ratio") else "N/A")
    with sc[2]: _kpi("Short % Float", _pct(m["short_percent"]*100,sign=False) if m.get("short_percent") else "N/A")
    with sc[3]: _kpi("Analyst Consensus", m.get("recommendation","N/A") or "N/A",
                     f'{m.get("analyst_count",0)} analysts')

    tgt_price = m.get("target_price")
    hype_cp   = m.get("current_price")
    if tgt_price and hype_cp:
        tgt_u = (tgt_price - hype_cp) / hype_cp * 100
        tc = st.columns(3)
        with tc[0]: _kpi("Analyst Target (Mean)", _price(tgt_price),
                         _pct(tgt_u, sign=True), _cc(tgt_u))
        with tc[1]: _kpi("Analyst Target (High)", _price(m.get("target_high")))
        with tc[2]: _kpi("Analyst Target (Low)",  _price(m.get("target_low")))


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
        bc, bt, bb = "#d1fae5","🟢  Potentially Undervalued","#10b981"
    elif upside < -15:
        bc, bt, bb = "#fee2e2","🔴  Potentially Overvalued","#ef4444"
    else:
        bc, bt, bb = "#fef9c3","🟡  Fairly Valued","#f59e0b"
    st.markdown(
        f'<div class="val-badge" style="background:{bc};border:2px solid {bb};">'
        f'<span style="font-size:1.1rem;font-weight:700;">{bt}</span>'
        f'<span style="color:#374151;font-size:0.9rem;">DCF: <strong>${iv:.2f}</strong> '
        f'vs market: <strong>${cp:.2f}</strong> ({upside:+.1f}%)</span></div>',
        unsafe_allow_html=True,
    )

    # Composite valuation chart
    st.markdown('<div class="sec">Valuation Comparison</div>', unsafe_allow_html=True)
    bars, bar_vals, bar_clrs = [], [], []

    def _bar(lbl, val, clr):
        if val and float(val) > 0:
            bars.append(lbl); bar_vals.append(float(val)); bar_clrs.append(clr)

    _bar("DCF Intrinsic Value",        iv,                          "#6366f1")
    _bar("Market Price",               cp,                          "#0f172a")
    if mults.get("pe_value"):
        _bar(f'P/E ({mults["pe_multiple"]}x sector avg)',           mults["pe_value"],        "#f59e0b")
    if mults.get("ev_ebitda_value"):
        _bar(f'EV/EBITDA ({mults["ev_ebitda_multiple"]}x sector avg)', mults["ev_ebitda_value"], "#3b82f6")
    if mults.get("composite"):
        _bar("Multiples Composite",    mults["composite"],          "#8b5cf6")
    _bar("52-Wk High",                 m.get("week_52_high"),       "#94a3b8")
    _bar("52-Wk Low",                  m.get("week_52_low"),        "#cbd5e1")
    if m.get("target_price"):
        _bar("Analyst Target",         m["target_price"],           "#10b981")

    if bars:
        fig = go.Figure(go.Bar(
            x=bar_vals, y=bars, orientation="h",
            marker_color=bar_clrs,
            text=[f"${v:.2f}" for v in bar_vals], textposition="outside",
        ))
        fig.add_vline(x=cp, line_dash="dash", line_color="#0f172a", line_width=2,
                      annotation_text="Market", annotation_position="top left")
        fig.update_layout(
            plot_bgcolor="white", paper_bgcolor="white",
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
                number={"suffix":" / 10","font":{"size":28,"color":conf["color"]}},
                gauge={
                    "axis":{"range":[0,10]},
                    "bar":{"color":conf["color"],"thickness":0.38},
                    "bgcolor":"white","borderwidth":0,
                    "steps":[
                        {"range":[0,4],"color":"#fee2e2"},
                        {"range":[4,6],"color":"#ffedd5"},
                        {"range":[6,8],"color":"#fef9c3"},
                        {"range":[8,10],"color":"#d1fae5"},
                    ],
                },
                title={"text":conf["level"],"font":{"size":15,"color":conf["color"]}},
            ))
            fig_c.update_layout(height=210, margin=dict(l=5,r=5,t=40,b=5), paper_bgcolor="white")
            st.plotly_chart(fig_c, use_container_width=True)
        with fc_col:
            st.markdown("**Score drivers:**")
            icons = {"positive":"✅","neutral":"⚪","negative":"❌"}
            for kind, text in conf["factors"]:
                st.markdown(f'<div class="factor">{icons.get(kind,"•")} {text}</div>',
                            unsafe_allow_html=True)

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
        fillcolor="rgba(99,102,241,0.15)",
        line=dict(color="#6366f1", width=2.5),
        marker=dict(size=7, color="#6366f1"),
        name="Score",
        hovertemplate="%{theta}: %{r}/6<extra></extra>",
    ))
    fig_radar.update_layout(
        polar=dict(
            radialaxis=dict(visible=True, range=[0, 6],
                           tickfont=dict(size=10), tickvals=[2, 4, 6]),
            angularaxis=dict(tickfont=dict(size=12, color="#1e293b")),
            bgcolor="rgba(248,250,252,0.8)",
        ),
        showlegend=False,
        paper_bgcolor="white", plot_bgcolor="white",
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
          <div class="kpi-val" style="font-size:2.4rem;color:{rank.get('color','#6366f1')}">
            {rank.get('rank', 0)}<span style="font-size:1rem;color:#94a3b8">/100</span>
          </div>
          <div class="kpi-sub" style="color:{rank.get('color','#6366f1')};font-weight:700">
            Grade {rank.get('grade','—')}  ·  Value+Growth+Quality
          </div>
        </div>""", unsafe_allow_html=True)
        for label, k in [("Value","value"),("Growth","growth"),
                         ("Quality","quality"),("Momentum","momentum"),("Income","income")]:
            v = pent.get(k, 0)
            pct = v / 6 * 100
            bar_color = "#10b981" if pct >= 67 else "#f59e0b" if pct >= 34 else "#ef4444"
            st.markdown(f"""
            <div style="margin-bottom:6px">
              <div style="display:flex;justify-content:space-between;font-size:0.75rem;
                          color:#64748b;margin-bottom:2px">
                <span>{label}</span><span style="font-weight:700">{v}/6</span>
              </div>
              <div style="height:6px;background:#f1f5f9;border-radius:99px;overflow:hidden">
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
            name="Revenue", marker_color="#6366f1", opacity=0.85))
        fig_hist.add_trace(go.Bar(
            x=years_r, y=list(reversed(hist_f["gross_profit"])),
            name="Gross Profit", marker_color="#22d3ee", opacity=0.85))
        fig_hist.add_trace(go.Bar(
            x=years_r, y=list(reversed(hist_f["fcf"])),
            name="Free Cash Flow", marker_color="#10b981", opacity=0.85))
        fig_hist.add_trace(go.Bar(
            x=years_r, y=list(reversed(hist_f["net_income"])),
            name="Net Income", marker_color="#f59e0b", opacity=0.85))
        fig_hist.update_layout(
            barmode="group",
            xaxis=dict(type="category"),
            yaxis=dict(ticksuffix="B", tickprefix="$"),
            plot_bgcolor="white", paper_bgcolor="white",
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
                icon, col = "✅", "#10b981"
            elif passed is False:
                icon, col = "❌", "#ef4444"
            else:
                icon, col = "⬜", "#94a3b8"
            st.markdown(
                f'<div style="display:flex;align-items:flex-start;gap:8px;'
                f'padding:5px 0;border-bottom:1px solid #f1f5f9;">'
                f'<span style="flex-shrink:0;font-size:0.9rem">{icon}</span>'
                f'<div><span style="font-size:0.82rem;font-weight:600;color:#1e293b">{name}</span>'
                f'<br><span style="font-size:0.72rem;color:#94a3b8">{detail}</span></div>'
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
          <div class="kpi-val" style="color:#10b981;font-size:1.1rem">Z &gt; 2.99</div>
          <div class="kpi-sub">Low bankruptcy risk</div>
        </div>
        <div class="kpi" style="margin-top:8px">
          <div class="kpi-lbl">Grey Zone</div>
          <div class="kpi-val" style="color:#f59e0b;font-size:1.1rem">1.81 – 2.99</div>
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
                    f'padding:4px 0;border-bottom:1px solid #f1f5f9;font-size:0.78rem">'
                    f'<span style="color:#64748b">{lbl}</span>'
                    f'<span style="font-weight:600">{f"{v_f:.3f}" if v_f is not None else "—"}</span>'
                    f'</div>',
                    unsafe_allow_html=True,
                )


# ─── Full analysis view ───────────────────────────────────────────────────────
def render_analysis(model: str | None, assumptions: dict):
    ticker = st.session_state.selected_ticker
    if not ensure_data(ticker, assumptions):
        return

    render_topbar(model)
    render_verdict_banner()
    render_overview()

    t1, t2, t3, t4, t5 = st.tabs([
        "📐  DCF Analysis",
        "📰  News & Sentiment",
        "🌡️  Hype Meter",
        "⚖️  Valuation vs. Market",
        "🏆  Scorecard",
    ])
    with t1: render_dcf_tab(model)
    with t2: render_news_tab(model)
    with t3: render_hype_tab()
    with t4: render_valuation_tab(model)
    with t5: render_scorecard_tab()

    st.markdown(
        '<hr style="border-color:#e2e8f0;margin-top:2rem;">'
        '<p style="color:#94a3b8;font-size:0.72rem;text-align:center;">'
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
