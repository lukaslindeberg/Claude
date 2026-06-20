"""
Stock DCF Analyzer
Local AI-powered fundamental analysis using Ollama + Yahoo Finance.
"""
import streamlit as st
import pandas as pd
import numpy as np
import plotly.graph_objects as go
from datetime import datetime

from modules.stock_data import search_companies, get_comprehensive_data, get_key_metrics
from modules.dcf import run_dcf_model, sensitivity_table, fmt
from modules.hype import calculate_hype_score
from modules.ai_analysis import (
    check_ollama_status,
    get_available_models,
    generate_dcf_narrative,
    analyze_news_sentiment,
    analyze_valuation_gap,
    calculate_confidence_score,
)

# ─── Page Config ──────────────────────────────────────────────────────────────
st.set_page_config(
    page_title="Stock DCF Analyzer",
    page_icon="📊",
    layout="wide",
    initial_sidebar_state="expanded",
)

# ─── CSS ──────────────────────────────────────────────────────────────────────
st.markdown(
    """
<style>
  /* Global */
  [data-testid="stAppViewContainer"] { background: #f0f4f8; }
  [data-testid="stSidebar"] { background: #1e293b; }
  [data-testid="stSidebar"] * { color: #e2e8f0 !important; }
  [data-testid="stSidebar"] .stMarkdown h2,
  [data-testid="stSidebar"] .stMarkdown h3 { color: #94a3b8 !important; font-size: 0.75rem !important; text-transform: uppercase; letter-spacing: 1px; }

  /* Cards */
  .card {
    background: white; border-radius: 12px; padding: 1.25rem 1.4rem;
    box-shadow: 0 1px 4px rgba(0,0,0,0.08); margin-bottom: 0.8rem;
  }
  .card-label { font-size: 0.72rem; color: #94a3b8; font-weight: 600;
    text-transform: uppercase; letter-spacing: 0.6px; margin-bottom: 2px; }
  .card-value { font-size: 1.55rem; font-weight: 700; color: #0f172a; }
  .card-sub   { font-size: 0.82rem; margin-top: 2px; font-weight: 500; }
  .green { color: #10b981; } .red { color: #ef4444; } .amber { color: #f59e0b; }

  /* Section header */
  .sec-header {
    font-size: 1.1rem; font-weight: 700; color: #1e293b;
    border-left: 4px solid #3b82f6; padding-left: 10px;
    margin: 1.2rem 0 0.8rem;
  }

  /* Analysis prose */
  .ai-box {
    background: white; border-radius: 10px; padding: 1.4rem 1.6rem;
    box-shadow: 0 1px 4px rgba(0,0,0,0.07); line-height: 1.7;
  }

  /* News cards */
  .news-item {
    background: white; border-radius: 8px; padding: 0.9rem 1.1rem;
    margin-bottom: 0.6rem; border-left: 3px solid #3b82f6;
    box-shadow: 0 1px 3px rgba(0,0,0,0.06);
  }
  .news-title { font-weight: 600; color: #1e293b; font-size: 0.9rem; }
  .news-meta  { font-size: 0.75rem; color: #94a3b8; margin-top: 3px; }

  /* Confidence factors */
  .factor { padding: 4px 0; font-size: 0.83rem; }

  /* Valuation badge */
  .val-badge {
    display: inline-block; padding: 6px 18px; border-radius: 999px;
    font-weight: 700; font-size: 1rem;
  }

  /* Tabs */
  .stTabs [data-baseweb="tab-list"] { gap: 6px; background: transparent; }
  .stTabs [data-baseweb="tab"] { border-radius: 8px 8px 0 0; font-weight: 500; }

  /* Hide streamlit menu */
  #MainMenu, footer { visibility: hidden; }
  header { visibility: hidden; }
</style>
""",
    unsafe_allow_html=True,
)


# ─── Session State ────────────────────────────────────────────────────────────
def _init_state():
    defaults = {
        "selected_ticker": None,
        "selected_name": None,
        "stock_data": None,
        "key_metrics": None,
        "dcf_results": None,
        "hype_data": None,
        "search_results": [],
        "ai_dcf": None,
        "ai_news": None,
        "ai_valuation": None,
        "confidence": None,
        "last_query": "",
    }
    for k, v in defaults.items():
        if k not in st.session_state:
            st.session_state[k] = v


_init_state()


# ─── Helpers ──────────────────────────────────────────────────────────────────
def _pct(v, decimals=1, sign=True) -> str:
    if v is None:
        return "N/A"
    s = f"{v:.{decimals}f}%"
    return ("+" if v > 0 else "") + s if sign else s


def _val(v, prefix="", suffix="", decimals=2) -> str:
    if v is None:
        return "N/A"
    return f"{prefix}{v:.{decimals}f}{suffix}"


def _color_class(v) -> str:
    if v is None:
        return ""
    return "green" if v > 0 else "red"


def _metric_card(label, value, sub=None, sub_color=None):
    sub_html = ""
    if sub is not None:
        cls = sub_color or ""
        sub_html = f'<div class="card-sub {cls}">{sub}</div>'
    st.markdown(
        f'<div class="card"><div class="card-label">{label}</div>'
        f'<div class="card-value">{value}</div>{sub_html}</div>',
        unsafe_allow_html=True,
    )


# ─── Sidebar ──────────────────────────────────────────────────────────────────
def render_sidebar() -> tuple[str | None, dict]:
    with st.sidebar:
        st.markdown("## 📊 Stock DCF Analyzer")
        st.markdown("---")

        # Ollama status
        st.markdown("### 🤖 AI Engine (Ollama)")
        ollama_ok = check_ollama_status()
        if ollama_ok:
            st.success("Ollama is running ✓")
            models = get_available_models()
            if models:
                selected_model = st.selectbox("Model", models, index=0)
            else:
                st.warning("No models found.\nRun: `ollama pull llama3.2`")
                selected_model = None
        else:
            st.error(
                "Ollama not running.\n\n"
                "1. Install from **ollama.ai**\n"
                "2. Run `ollama serve`\n"
                "3. Pull a model: `ollama pull llama3.2`"
            )
            selected_model = None

        st.markdown("---")
        st.markdown("### ⚙️ DCF Assumptions")

        rf = st.slider("Risk-Free Rate (%)", 1.0, 8.0, 4.5, 0.1) / 100
        mrp = st.slider("Market Risk Premium (%)", 3.0, 9.0, 5.5, 0.1) / 100
        tg = st.slider("Terminal Growth Rate (%)", 0.5, 5.0, 2.5, 0.1) / 100
        py = st.slider("Projection Years", 3, 10, 5, 1)
        ga = st.slider("Growth Adjustment (%)", -10.0, 10.0, 0.0, 0.5) / 100

        assumptions = {
            "risk_free_rate": rf,
            "market_risk_premium": mrp,
            "terminal_growth": tg,
            "projection_years": py,
            "growth_adjustment": ga,
        }

        st.markdown("---")
        st.caption("Data: Yahoo Finance · AI: Ollama (local)")
        st.caption("⚠️ For educational use only. Not financial advice.")

    return selected_model, assumptions


# ─── Search Section ───────────────────────────────────────────────────────────
def render_search():
    st.markdown(
        '<h1 style="margin-bottom:0; color:#1e293b;">📊 Stock DCF Analyzer</h1>',
        unsafe_allow_html=True,
    )
    st.markdown(
        '<p style="color:#64748b; margin-top:4px; font-size:1.05rem;">'
        "AI-powered intrinsic value analysis — fully local, no subscriptions needed.</p>",
        unsafe_allow_html=True,
    )

    query = st.text_input(
        "Search for a company",
        placeholder="e.g. Apple, Tesla, ASML, Nvidia …",
        label_visibility="collapsed",
    )

    if query and query != st.session_state.last_query:
        st.session_state.last_query = query
        with st.spinner("Searching…"):
            st.session_state.search_results = search_companies(query)
        # Clear previous analysis
        for k in ("stock_data", "key_metrics", "dcf_results", "hype_data",
                  "ai_dcf", "ai_news", "ai_valuation", "confidence", "selected_ticker"):
            st.session_state[k] = None

    if st.session_state.search_results:
        options = {
            f"{r['name']} ({r['symbol']}) — {r['exchange']}": r["symbol"]
            for r in st.session_state.search_results
        }
        choice = st.radio("Select company", list(options.keys()), label_visibility="collapsed")
        if st.button("▶  Analyse", type="primary", use_container_width=True):
            st.session_state.selected_ticker = options[choice]
            st.session_state.selected_name = choice
            # Clear old results
            for k in ("stock_data", "key_metrics", "dcf_results", "hype_data",
                      "ai_dcf", "ai_news", "ai_valuation", "confidence"):
                st.session_state[k] = None
            st.rerun()


# ─── Overview Section ─────────────────────────────────────────────────────────
def render_overview(m: dict):
    name = m.get("name", "")
    ticker = m.get("ticker", "")
    sector = m.get("sector", "N/A")
    industry = m.get("industry", "N/A")
    price = m.get("current_price", 0)
    chg_pct = m.get("price_change_pct", 0)
    chg = m.get("price_change", 0)
    color = "green" if chg >= 0 else "red"
    arrow = "▲" if chg >= 0 else "▼"

    st.markdown(
        f'<h2 style="margin-bottom:2px; color:#1e293b;">{name} '
        f'<span style="color:#64748b; font-size:1rem;">({ticker})</span></h2>'
        f'<p style="color:#94a3b8; margin-top:0;">{sector} · {industry} · '
        f'{m.get("country","")}</p>',
        unsafe_allow_html=True,
    )

    # Top metrics row
    c1, c2, c3, c4, c5, c6 = st.columns(6)
    with c1:
        _metric_card(
            "Current Price",
            f"${price:.2f}",
            f'{arrow} {abs(chg_pct):.2f}% today',
            color,
        )
    with c2:
        _metric_card("Market Cap", fmt(m.get("market_cap"), "$"))
    with c3:
        _metric_card(
            "Revenue (TTM)",
            fmt(m.get("revenue"), "$"),
            _pct(m.get("revenue_growth", 0) * 100 if m.get("revenue_growth") else None,
                 sign=True) + " YoY" if m.get("revenue_growth") else None,
        )
    with c4:
        _metric_card(
            "P/E Ratio",
            _val(m.get("pe_ratio"), decimals=1) + "x" if m.get("pe_ratio") else "N/A",
            f'Fwd {_val(m.get("forward_pe"), decimals=1)}x' if m.get("forward_pe") else None,
        )
    with c5:
        _metric_card(
            "52-Wk Range",
            f"${m.get('week_52_low',0):.0f} – ${m.get('week_52_high',0):.0f}",
        )
    with c6:
        _metric_card(
            "Beta",
            _val(m.get("beta"), decimals=2),
            "vs S&P 500",
        )

    # Second row
    c1, c2, c3, c4, c5, c6 = st.columns(6)
    with c1:
        _metric_card(
            "Op. Margin",
            _pct(m.get("operating_margin", 0) * 100 if m.get("operating_margin") else None, sign=False),
        )
    with c2:
        _metric_card("EV / EBITDA", _val(m.get("ev_ebitda"), decimals=1) + "x" if m.get("ev_ebitda") else "N/A")
    with c3:
        _metric_card("ROE", _pct(m.get("roe", 0) * 100 if m.get("roe") else None, sign=False))
    with c4:
        _metric_card("Net Cash / Debt", fmt(
            (m.get("total_cash") or 0) - (m.get("total_debt") or 0), "$"
        ))
    with c5:
        _metric_card(
            "Dividend Yield",
            _pct(m.get("dividend_yield", 0) * 100 if m.get("dividend_yield") else None, sign=False)
            if m.get("dividend_yield") else "—",
        )
    with c6:
        _metric_card(
            "1-Year Return",
            _pct(m.get("ytd_return"), sign=True) if m.get("ytd_return") is not None else "N/A",
            sub_color=_color_class(m.get("ytd_return")),
        )

    # Price chart
    hist = st.session_state.stock_data.get("history_1y", pd.DataFrame())
    if not hist.empty:
        hist["MA50"] = hist["Close"].rolling(50).mean()
        hist["MA200"] = hist["Close"].rolling(200).mean()

        fig = go.Figure()
        fig.add_trace(go.Scatter(
            x=hist.index, y=hist["Close"],
            name="Price", line=dict(color="#3b82f6", width=2),
            hovertemplate="$%{y:.2f}<extra></extra>",
        ))
        fig.add_trace(go.Scatter(
            x=hist.index, y=hist["MA50"],
            name="50-day MA", line=dict(color="#f59e0b", width=1.5, dash="dot"),
        ))
        fig.add_trace(go.Scatter(
            x=hist.index, y=hist["MA200"],
            name="200-day MA", line=dict(color="#ef4444", width=1.5, dash="dot"),
        ))
        fig.add_trace(go.Bar(
            x=hist.index, y=hist["Volume"],
            name="Volume", yaxis="y2",
            marker_color="rgba(59,130,246,0.15)",
        ))
        fig.update_layout(
            yaxis2=dict(overlaying="y", side="right", showgrid=False,
                        title="Volume", tickformat=".2s"),
            plot_bgcolor="white", paper_bgcolor="white",
            legend=dict(orientation="h", y=1.08),
            margin=dict(l=0, r=0, t=30, b=0),
            height=320, hovermode="x unified",
        )
        st.plotly_chart(fig, use_container_width=True)

    # Description
    if m.get("description"):
        with st.expander("About the company"):
            st.markdown(m["description"])


# ─── DCF Tab ──────────────────────────────────────────────────────────────────
def render_dcf_tab(model: str | None):
    dcf = st.session_state.dcf_results
    m = st.session_state.key_metrics
    if not dcf:
        st.info("Run an analysis first.")
        return

    iv = dcf.get("intrinsic_value", 0)
    cp = dcf.get("current_price", 0)
    upside = dcf.get("upside_pct", 0)
    wacc = dcf.get("wacc_data", {}).get("wacc", 0)

    # Key DCF metrics
    c1, c2, c3, c4, c5 = st.columns(5)
    with c1:
        _metric_card("Intrinsic Value", f"${iv:.2f}" if iv else "N/A")
    with c2:
        ucolor = "green" if upside > 0 else "red"
        _metric_card("Upside / Downside", _pct(upside, sign=True), sub_color=ucolor)
    with c3:
        _metric_card("WACC", _pct(wacc * 100, sign=False))
    with c4:
        _metric_card("Enterprise Value", fmt(dcf.get("enterprise_value"), "$"))
    with c5:
        _metric_card("Terminal Value %", f'{dcf.get("pv_terminal_pct",0):.0f}% of EV')

    # Warnings
    for w in dcf.get("warnings", []):
        st.warning(f"⚠️ {w}")

    # FCF Chart
    st.markdown('<div class="sec-header">Free Cash Flow: Historical vs Projected</div>', unsafe_allow_html=True)

    hist_fcf = dcf.get("fcf_history", [])
    hist_yrs = dcf.get("fcf_years", [])
    proj_fcf = dcf.get("projected_fcf", [])
    py = dcf.get("assumptions", {}).get("projection_years", 5)
    max_yr = max(hist_yrs) if hist_yrs else datetime.now().year
    proj_yrs = list(range(max_yr + 1, max_yr + 1 + py))

    fig = go.Figure()
    if hist_fcf and hist_yrs:
        fig.add_trace(go.Bar(
            x=[str(y) for y in reversed(hist_yrs)],
            y=[v / 1e9 for v in reversed(hist_fcf)],
            name="Historical FCF",
            marker_color=["#94a3b8" if v < 0 else "#3b82f6" for v in reversed(hist_fcf)],
        ))
    if proj_fcf:
        fig.add_trace(go.Bar(
            x=[str(y) for y in proj_yrs],
            y=[v / 1e9 for v in proj_fcf],
            name="Projected FCF",
            marker_color="#10b981",
            opacity=0.85,
        ))
    fig.update_layout(
        barmode="group",
        yaxis_title="FCF ($B)",
        plot_bgcolor="white", paper_bgcolor="white",
        legend=dict(orientation="h", y=1.08),
        margin=dict(l=0, r=0, t=20, b=0), height=280,
    )
    st.plotly_chart(fig, use_container_width=True)

    # WACC breakdown
    wd = dcf.get("wacc_data", {})
    st.markdown('<div class="sec-header">WACC Breakdown</div>', unsafe_allow_html=True)
    wc1, wc2, wc3, wc4 = st.columns(4)
    with wc1:
        _metric_card("Beta", f'{wd.get("beta", 1.0):.2f}')
    with wc2:
        _metric_card("Cost of Equity", _pct(wd.get("cost_of_equity", 0) * 100, sign=False))
    with wc3:
        _metric_card("Cost of Debt (after-tax)", _pct(wd.get("after_tax_cost_of_debt", 0) * 100, sign=False))
    with wc4:
        _metric_card("Debt / Total Capital", _pct(wd.get("debt_weight", 0) * 100, sign=False))

    # Sensitivity table
    st.markdown('<div class="sec-header">Sensitivity Analysis — Intrinsic Value per Share ($)</div>',
                unsafe_allow_html=True)
    try:
        if dcf.get("shares_outstanding", 0) > 0:
            sens = sensitivity_table(dcf)
            # Color-code cells relative to current price
            def highlight(val):
                if val is None or cp == 0:
                    return "background-color: #f1f5f9"
                if val > cp * 1.15:
                    return "background-color: #d1fae5; color: #065f46"
                if val < cp * 0.85:
                    return "background-color: #fee2e2; color: #991b1b"
                return "background-color: #fef9c3; color: #92400e"
            st.dataframe(
                sens.style.applymap(highlight).format("${:.2f}", na_rep="N/A"),
                use_container_width=True,
            )
            st.caption(
                "Green = >15% upside · Yellow = fairly valued · Red = >15% downside  "
                "(rows = WACC ± 2%, columns = terminal growth rate)"
            )
    except Exception as e:
        st.caption(f"Sensitivity table unavailable: {e}")

    # AI Narrative
    st.markdown('<div class="sec-header">AI-Generated DCF Report</div>', unsafe_allow_html=True)
    if model is None:
        st.info("Start Ollama and select a model in the sidebar to generate the AI analysis.")
    elif st.session_state.ai_dcf:
        with st.container():
            st.markdown(
                f'<div class="ai-box">{st.session_state.ai_dcf}</div>',
                unsafe_allow_html=True,
            )
    else:
        if st.button("Generate DCF Analysis with AI", key="gen_dcf"):
            chunks = []
            placeholder = st.empty()
            for chunk in generate_dcf_narrative(m, dcf, model):
                chunks.append(chunk)
                placeholder.markdown("".join(chunks))
            st.session_state.ai_dcf = "".join(chunks)
            st.rerun()


# ─── News Tab ─────────────────────────────────────────────────────────────────
def render_news_tab(model: str | None):
    sd = st.session_state.stock_data
    m = st.session_state.key_metrics
    if not sd:
        return

    news = sd.get("news", [])
    if not news:
        st.info("No recent news found for this company.")
        return

    st.markdown(f'<div class="sec-header">Recent News ({len(news)} articles)</div>',
                unsafe_allow_html=True)

    for item in news:
        title = item.get("title", "No title")
        publisher = item.get("publisher", "")
        link = item.get("link", "#")
        ts = item.get("providerPublishTime")
        date_str = ""
        if ts:
            try:
                date_str = datetime.fromtimestamp(ts).strftime("%b %d, %Y")
            except Exception:
                pass
        st.markdown(
            f'<div class="news-item">'
            f'<div class="news-title"><a href="{link}" target="_blank" '
            f'style="color:#1e293b; text-decoration:none;">{title}</a></div>'
            f'<div class="news-meta">{publisher} · {date_str}</div>'
            f"</div>",
            unsafe_allow_html=True,
        )

    st.markdown('<div class="sec-header">AI News Sentiment Analysis</div>', unsafe_allow_html=True)

    if model is None:
        st.info("Start Ollama and select a model to generate sentiment analysis.")
    elif st.session_state.ai_news:
        st.markdown(
            f'<div class="ai-box">{st.session_state.ai_news}</div>',
            unsafe_allow_html=True,
        )
    else:
        if st.button("Analyse News Sentiment with AI", key="gen_news"):
            chunks = []
            placeholder = st.empty()
            for chunk in analyze_news_sentiment(news, m.get("name", ""), model):
                chunks.append(chunk)
                placeholder.markdown("".join(chunks))
            st.session_state.ai_news = "".join(chunks)
            st.rerun()


# ─── Hype Meter Tab ───────────────────────────────────────────────────────────
def render_hype_tab():
    hype = st.session_state.hype_data
    m = st.session_state.key_metrics
    if not hype:
        return

    score = hype["score"]
    level = hype["level"]
    color = hype["color"]
    emoji = hype["emoji"]

    col_gauge, col_details = st.columns([1, 1])

    with col_gauge:
        # Gauge chart
        fig = go.Figure(go.Indicator(
            mode="gauge+number",
            value=score,
            number={"suffix": " / 100", "font": {"size": 28, "color": "#1e293b"}},
            gauge={
                "axis": {"range": [0, 100], "tickwidth": 1, "tickcolor": "#94a3b8"},
                "bar": {"color": color, "thickness": 0.35},
                "bgcolor": "white",
                "borderwidth": 0,
                "steps": [
                    {"range": [0, 20],  "color": "#e2e8f0"},
                    {"range": [20, 40], "color": "#dbeafe"},
                    {"range": [40, 60], "color": "#fef9c3"},
                    {"range": [60, 80], "color": "#ffedd5"},
                    {"range": [80, 100],"color": "#fee2e2"},
                ],
                "threshold": {
                    "line": {"color": color, "width": 4},
                    "thickness": 0.85,
                    "value": score,
                },
            },
            title={"text": f"{emoji}  Hype Meter", "font": {"size": 18}},
        ))
        fig.update_layout(
            height=300, margin=dict(l=10, r=10, t=40, b=10),
            paper_bgcolor="white",
        )
        st.plotly_chart(fig, use_container_width=True)
        st.markdown(
            f'<div style="text-align:center; font-size:1.3rem; font-weight:700; color:{color};">'
            f'{level}</div>',
            unsafe_allow_html=True,
        )

    with col_details:
        st.markdown('<div class="sec-header">Score Breakdown</div>', unsafe_allow_html=True)
        for label, comp in hype["components"].items():
            s = comp["score"]
            mx = comp["max"]
            detail = comp["detail"]
            pct = s / mx * 100
            bar_color = "#10b981" if pct >= 66 else ("#f59e0b" if pct >= 33 else "#ef4444")
            st.markdown(
                f"**{label}** — {detail}  \n"
                f'<div style="height:8px; background:#e2e8f0; border-radius:4px; overflow:hidden;">'
                f'<div style="width:{pct:.0f}%; height:100%; background:{bar_color}; border-radius:4px;"></div>'
                f"</div>"
                f'<div style="font-size:0.75rem; color:#64748b; margin-bottom:12px;">'
                f"{s:.0f} / {mx} points</div>",
                unsafe_allow_html=True,
            )

    # Additional market data
    st.markdown('<div class="sec-header">Market Sentiment Data</div>', unsafe_allow_html=True)
    s1, s2, s3, s4 = st.columns(4)
    with s1:
        _metric_card("Avg Daily Volume", fmt(m.get("avg_volume")))
    with s2:
        sr = m.get("short_ratio")
        _metric_card("Short Ratio", f'{sr:.1f} days' if sr else "N/A")
    with s3:
        sp = m.get("short_percent")
        _metric_card("Short % of Float", _pct(sp * 100, sign=False) if sp else "N/A")
    with s4:
        rec = m.get("recommendation", "")
        an = m.get("analyst_count", 0)
        _metric_card("Analyst Consensus", rec or "N/A", f"{an} analysts" if an else None)

    # Analyst price targets
    target = m.get("target_price")
    if target and m.get("current_price"):
        cp = m["current_price"]
        tgt_upside = (target - cp) / cp * 100
        t1, t2, t3 = st.columns(3)
        with t1:
            _metric_card("Analyst Target (Mean)", f"${target:.2f}",
                         _pct(tgt_upside, sign=True),
                         sub_color=_color_class(tgt_upside))
        with t2:
            th = m.get("target_high")
            _metric_card("Analyst Target (High)", f"${th:.2f}" if th else "N/A")
        with t3:
            tl = m.get("target_low")
            _metric_card("Analyst Target (Low)", f"${tl:.2f}" if tl else "N/A")


# ─── Valuation Tab ────────────────────────────────────────────────────────────
def render_valuation_tab(model: str | None):
    dcf = st.session_state.dcf_results
    m = st.session_state.key_metrics
    if not dcf:
        return

    iv = dcf.get("intrinsic_value", 0)
    cp = dcf.get("current_price", 0)
    upside = dcf.get("upside_pct", 0)
    conf = st.session_state.confidence

    # Valuation status badge
    if upside > 15:
        badge_color, badge_text = "#d1fae5", "🟢 Potentially Undervalued"
        badge_border = "#10b981"
    elif upside < -15:
        badge_color, badge_text = "#fee2e2", "🔴 Potentially Overvalued"
        badge_border = "#ef4444"
    else:
        badge_color, badge_text = "#fef9c3", "🟡 Fairly Valued"
        badge_border = "#f59e0b"

    st.markdown(
        f'<div style="background:{badge_color}; border:2px solid {badge_border}; '
        f'border-radius:10px; padding:14px 20px; margin-bottom:16px;">'
        f'<span style="font-size:1.2rem; font-weight:700;">{badge_text}</span>'
        f'<span style="margin-left:16px; color:#374151;">DCF value '
        f'<strong>${iv:.2f}</strong> vs. market price <strong>${cp:.2f}</strong> '
        f'({upside:+.1f}%)</span></div>',
        unsafe_allow_html=True,
    )

    # Comparison chart
    st.markdown('<div class="sec-header">Valuation Comparison</div>', unsafe_allow_html=True)

    labels, values, colors = [], [], []

    def add(label, val, color):
        if val and val > 0:
            labels.append(label)
            values.append(val)
            colors.append(color)

    add("DCF Intrinsic Value", iv, "#10b981")
    add("Current Price", cp, "#3b82f6")
    add("52-Wk High", m.get("week_52_high"), "#f59e0b")
    add("52-Wk Low", m.get("week_52_low"), "#94a3b8")
    add("Analyst Target", m.get("target_price"), "#8b5cf6")

    fig = go.Figure(go.Bar(
        x=values,
        y=labels,
        orientation="h",
        marker_color=colors,
        text=[f"${v:.2f}" for v in values],
        textposition="outside",
    ))
    fig.add_vline(x=cp, line_dash="dash", line_color="#3b82f6", line_width=2,
                  annotation_text="Market Price", annotation_position="top right")
    fig.update_layout(
        plot_bgcolor="white", paper_bgcolor="white",
        xaxis_title="Price ($)",
        margin=dict(l=0, r=60, t=10, b=0), height=240,
        showlegend=False,
    )
    st.plotly_chart(fig, use_container_width=True)

    # Confidence score
    if conf:
        st.markdown('<div class="sec-header">Model Confidence Score</div>', unsafe_allow_html=True)
        score = conf["score"]
        level = conf["level"]
        color = conf["color"]

        col_score, col_factors = st.columns([1, 2])
        with col_score:
            fig_conf = go.Figure(go.Indicator(
                mode="gauge+number",
                value=score,
                number={"suffix": " / 10", "font": {"size": 30, "color": color}},
                gauge={
                    "axis": {"range": [0, 10]},
                    "bar": {"color": color, "thickness": 0.4},
                    "bgcolor": "white",
                    "borderwidth": 0,
                    "steps": [
                        {"range": [0, 4], "color": "#fee2e2"},
                        {"range": [4, 6], "color": "#ffedd5"},
                        {"range": [6, 8], "color": "#fef9c3"},
                        {"range": [8, 10], "color": "#d1fae5"},
                    ],
                },
                title={"text": level, "font": {"size": 16, "color": color}},
            ))
            fig_conf.update_layout(
                height=220, margin=dict(l=10, r=10, t=40, b=10),
                paper_bgcolor="white",
            )
            st.plotly_chart(fig_conf, use_container_width=True)

        with col_factors:
            st.markdown("**What drives this score:**")
            icons = {"positive": "✅", "neutral": "⚪", "negative": "❌"}
            for kind, text in conf["factors"]:
                st.markdown(
                    f'<div class="factor">{icons.get(kind,"•")} {text}</div>',
                    unsafe_allow_html=True,
                )

    # AI gap analysis
    st.markdown('<div class="sec-header">AI: Why Does the Gap Exist?</div>', unsafe_allow_html=True)
    if model is None:
        st.info("Start Ollama and select a model to generate this analysis.")
    elif st.session_state.ai_valuation:
        st.markdown(
            f'<div class="ai-box">{st.session_state.ai_valuation}</div>',
            unsafe_allow_html=True,
        )
    else:
        if st.button("Generate Valuation Analysis with AI", key="gen_val"):
            chunks = []
            placeholder = st.empty()
            for chunk in analyze_valuation_gap(dcf, m, model):
                chunks.append(chunk)
                placeholder.markdown("".join(chunks))
            st.session_state.ai_valuation = "".join(chunks)
            st.rerun()


# ─── Full Analysis ────────────────────────────────────────────────────────────
def render_analysis(model: str | None, assumptions: dict):
    ticker = st.session_state.selected_ticker
    if not ticker:
        return

    # Fetch & compute if not cached
    if st.session_state.stock_data is None:
        with st.spinner(f"Loading data for {ticker} …"):
            sd = get_comprehensive_data(ticker)
            if sd is None:
                st.error("Could not load data. Try a different ticker.")
                st.session_state.selected_ticker = None
                return
            st.session_state.stock_data = sd
            st.session_state.key_metrics = get_key_metrics(sd)
            st.session_state.dcf_results = run_dcf_model(sd, assumptions)
            st.session_state.hype_data = calculate_hype_score(sd)
            st.session_state.confidence = calculate_confidence_score(
                st.session_state.dcf_results, st.session_state.key_metrics
            )

    m = st.session_state.key_metrics
    render_overview(m)

    tab1, tab2, tab3, tab4 = st.tabs([
        "📐 DCF Analysis",
        "📰 News & Sentiment",
        "🌡️ Hype Meter",
        "⚖️ Valuation vs. Market",
    ])
    with tab1:
        render_dcf_tab(model)
    with tab2:
        render_news_tab(model)
    with tab3:
        render_hype_tab()
    with tab4:
        render_valuation_tab(model)

    st.markdown(
        '<hr><p style="color:#94a3b8; font-size:0.75rem; text-align:center;">'
        "⚠️  This tool is for educational purposes only and does not constitute financial advice. "
        "Always consult a qualified professional before making investment decisions. "
        "Data sourced from Yahoo Finance.</p>",
        unsafe_allow_html=True,
    )


# ─── Main ─────────────────────────────────────────────────────────────────────
def main():
    model, assumptions = render_sidebar()

    if st.session_state.selected_ticker:
        # Re-analyse button
        col_back, col_re = st.columns([5, 1])
        with col_back:
            if st.button("← New Search"):
                for k in ("selected_ticker", "selected_name", "stock_data", "key_metrics",
                          "dcf_results", "hype_data", "ai_dcf", "ai_news",
                          "ai_valuation", "confidence", "search_results", "last_query"):
                    st.session_state[k] = None if k != "search_results" else []
                    if k == "last_query":
                        st.session_state[k] = ""
                st.rerun()
        with col_re:
            if st.button("↺ Re-analyse"):
                for k in ("stock_data", "key_metrics", "dcf_results", "hype_data",
                          "ai_dcf", "ai_news", "ai_valuation", "confidence"):
                    st.session_state[k] = None
                st.rerun()

        render_analysis(model, assumptions)
    else:
        render_search()


if __name__ == "__main__":
    main()
