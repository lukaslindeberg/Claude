"""Ollama integration for AI-powered financial analysis."""
from __future__ import annotations

try:
    import ollama as _ollama
    _OLLAMA_AVAILABLE = True
except ImportError:
    _OLLAMA_AVAILABLE = False


# ─── Status helpers ───────────────────────────────────────────────────────────

def check_ollama_status() -> bool:
    if not _OLLAMA_AVAILABLE:
        return False
    try:
        _ollama.list()
        return True
    except Exception:
        return False


def get_available_models() -> list[str]:
    if not _OLLAMA_AVAILABLE:
        return []
    try:
        resp = _ollama.list()
        models = resp.get("models", [])
        return [m["name"] for m in models if m.get("name")]
    except Exception:
        return []


# ─── Private streaming helper ─────────────────────────────────────────────────

def _stream(model: str, system: str, user: str):
    """Yield content chunks from an Ollama streaming chat call."""
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": user})
    try:
        stream = _ollama.chat(model=model, messages=messages, stream=True)
        for chunk in stream:
            content = chunk.get("message", {}).get("content", "")
            if content:
                yield content
    except Exception as e:
        yield f"\n\n⚠️  Ollama error: {e}"


# ─── DCF Narrative ────────────────────────────────────────────────────────────

def generate_dcf_narrative(key_metrics: dict, dcf: dict, model: str):
    """Stream a full professional DCF analysis report."""
    name = key_metrics.get("name", "the company")
    ticker = key_metrics.get("ticker", "")
    sector = key_metrics.get("sector", "N/A")
    revenue = key_metrics.get("revenue", 0) or 0
    op_margin = key_metrics.get("operating_margin") or 0

    fcf = dcf.get("current_fcf", 0)
    iv = dcf.get("intrinsic_value", 0)
    cp = dcf.get("current_price", 0)
    upside = dcf.get("upside_pct", 0)
    wacc = dcf.get("wacc_data", {}).get("wacc", 0.10)
    beta = dcf.get("wacc_data", {}).get("beta", 1.0)
    cagr = dcf.get("growth_rates", {}).get("cagr", 0.10)
    tg = dcf.get("assumptions", {}).get("terminal_growth", 0.025)
    proj = dcf.get("projected_fcf", [])
    source = dcf.get("data_source", "calculated")
    warns = dcf.get("warnings", [])
    pv_tv_pct = dcf.get("pv_terminal_pct", 0)
    ev = dcf.get("enterprise_value", 0)
    net_debt = dcf.get("net_debt", 0)

    proj_str = ", ".join(
        f"Yr{i+1}: ${v/1e9:.2f}B" for i, v in enumerate(proj)
    ) if proj else "N/A"

    user_prompt = f"""Write a professional equity research DCF report for {name} ({ticker}).

COMPANY: {name} | Sector: {sector}
FINANCIALS:
  Revenue: ${revenue/1e9:.2f}B | Operating Margin: {op_margin*100:.1f}% | FCF (latest): ${fcf/1e9:.2f}B
  Historical FCF CAGR: {cagr*100:.1f}% | Data quality: {source}

DCF MODEL:
  WACC: {wacc*100:.2f}% | Beta: {beta:.2f} | Terminal growth: {tg*100:.1f}%
  Projected FCF: {proj_str}
  Enterprise Value: ${ev/1e9:.2f}B | Net Debt: ${net_debt/1e9:.2f}B
  Intrinsic value: ${iv:.2f} vs market price: ${cp:.2f} → implied upside: {upside:+.1f}%
  Terminal value as % of EV: {pv_tv_pct:.0f}%
  Model notes: {'; '.join(warns) if warns else 'None'}

Write exactly four sections with these Markdown headers:
## Executive Summary
## Business & Financial Overview
## DCF Assumptions & Methodology
## Valuation Conclusion & Risks

Be data-driven, balanced, and professional. 450–600 words total. Use specific numbers from above."""

    system = (
        "You are a senior equity analyst at a top-tier investment bank. "
        "Write precise, insightful, and balanced financial analysis. "
        "Never give buy/sell advice — only present analysis."
    )
    yield from _stream(model, system, user_prompt)


# ─── News Sentiment ───────────────────────────────────────────────────────────

def analyze_news_sentiment(news_items: list, company_name: str, model: str):
    """Stream a concise news sentiment and impact analysis."""
    if not news_items:
        yield "No recent news articles found for this company."
        return

    headlines = "\n".join(
        f"• {item.get('title', 'No title')} — {item.get('publisher', 'Unknown')}"
        for item in news_items[:12]
    )

    user_prompt = f"""Analyze these recent news headlines for {company_name} from an investment perspective.

HEADLINES:
{headlines}

Provide:
**Overall Sentiment:** [Bullish / Bearish / Mixed / Neutral] — one-sentence justification

**Key Themes** (3 bullets max):
- ...

**Potential Price Impact:** 2–3 sentences on how these headlines could move the stock

**Investor Watch Points:** 2 bullets of what to monitor going forward

Keep it concise and focused on what matters to investors."""

    yield from _stream(model, "", user_prompt)


# ─── Valuation Gap Analysis ───────────────────────────────────────────────────

def analyze_valuation_gap(dcf: dict, key_metrics: dict, model: str):
    """Stream analysis explaining the gap between DCF value and market price."""
    iv = dcf.get("intrinsic_value", 0)
    cp = dcf.get("current_price", 0)
    upside = dcf.get("upside_pct", 0)
    sector = key_metrics.get("sector", "N/A")
    pe = key_metrics.get("pe_ratio")
    fwd_pe = key_metrics.get("forward_pe")
    pb = key_metrics.get("pb_ratio")
    ev_ebitda = key_metrics.get("ev_ebitda")
    name = key_metrics.get("name", "the company")
    target = key_metrics.get("target_price")

    if upside > 15:
        status = "POTENTIALLY UNDERVALUED by the DCF model"
    elif upside < -15:
        status = "POTENTIALLY OVERVALUED by the DCF model"
    else:
        status = "FAIRLY VALUED relative to the DCF model"

    mkt_multiples = f"""  P/E (trailing): {f"{pe:.1f}x" if pe else "N/A"}
  P/E (forward): {f"{fwd_pe:.1f}x" if fwd_pe else "N/A"}
  P/B: {f"{pb:.2f}x" if pb else "N/A"}
  EV/EBITDA: {f"{ev_ebitda:.1f}x" if ev_ebitda else "N/A"}
  Analyst consensus target: {f"${target:.2f}" if target else "N/A"}"""

    user_prompt = f"""Explain the valuation gap for {name}.

DCF intrinsic value: ${iv:.2f} | Market price: ${cp:.2f} | Gap: {upside:+.1f}%
DCF assessment: {status}
Sector: {sector}

Market valuation multiples:
{mkt_multiples}

Write three focused paragraphs:
1. **Why the gap exists** — DCF assumptions vs. what the market is pricing in
2. **Market & qualitative factors** — growth expectations, sentiment, sector dynamics
3. **Key considerations** — what an investor should weigh before acting

Be balanced, specific, and avoid giving direct buy/sell advice."""

    yield from _stream(model, "", user_prompt)


# ─── Confidence Score ─────────────────────────────────────────────────────────

def calculate_confidence_score(dcf: dict, key_metrics: dict) -> dict:
    """
    Compute a rule-based 1–10 confidence score for the DCF valuation.
    Returns score, level, color, and list of contributing factors.
    """
    score = 5.0
    factors = []

    # Data quality
    source = dcf.get("data_source", "estimated")
    if source == "direct":
        score += 1.5
        factors.append(("positive", "Direct FCF data available from cash flow statement"))
    elif source == "calculated":
        score += 0.8
        factors.append(("positive", "FCF calculated from operating CF and CapEx"))
    elif source == "operating_cf":
        score += 0.2
        factors.append(("neutral", "Using operating cash flow as FCF proxy (CapEx unavailable)"))
    else:
        score -= 1.5
        factors.append(("negative", "FCF estimated from revenue & margins — limited accuracy"))

    # FCF positivity
    if (dcf.get("current_fcf") or 0) > 0:
        score += 0.8
        factors.append(("positive", "Positive free cash flow — model is directly applicable"))
    else:
        score -= 2.0
        factors.append(("negative", "Negative FCF — DCF is unreliable for pre-profitability companies"))

    # Cash flow stability
    stability = dcf.get("growth_rates", {}).get("stability", "low")
    if stability == "high":
        score += 1.2
        factors.append(("positive", "Highly stable and predictable cash flows"))
    elif stability == "medium":
        score += 0.4
        factors.append(("neutral", "Moderately stable cash flows"))
    else:
        score -= 0.6
        factors.append(("negative", "Variable or volatile cash flows reduce model reliability"))

    # Beta / risk predictability
    beta = dcf.get("wacc_data", {}).get("beta", 1.0)
    if 0.4 <= beta <= 1.6:
        score += 0.3
        factors.append(("positive", f"Normal beta ({beta:.2f}) — risk discount is well-calibrated"))
    else:
        score -= 0.5
        factors.append(("negative", f"Extreme beta ({beta:.2f}) increases WACC uncertainty"))

    # Terminal value dominance (>80% of EV = fragile)
    tv_pct = dcf.get("pv_terminal_pct", 50)
    if tv_pct > 80:
        score -= 1.0
        factors.append(("negative", f"Terminal value is {tv_pct:.0f}% of EV — highly sensitive to assumptions"))
    elif tv_pct > 65:
        score -= 0.4
        factors.append(("neutral", f"Terminal value is {tv_pct:.0f}% of EV — moderately sensitive"))
    else:
        score += 0.3
        factors.append(("positive", f"Terminal value is {tv_pct:.0f}% of EV — reasonable proportion"))

    # Analyst coverage as validation proxy
    analyst_count = key_metrics.get("analyst_count") or 0
    if analyst_count >= 10:
        score += 0.5
        factors.append(("positive", f"{analyst_count} analysts cover this stock — well-followed company"))
    elif analyst_count >= 3:
        score += 0.2
        factors.append(("neutral", f"{analyst_count} analysts cover this stock"))
    else:
        score -= 0.3
        factors.append(("negative", "Little to no analyst coverage — less external validation"))

    # Per-warning penalty
    for w in dcf.get("warnings", []):
        score -= 0.4
        factors.append(("negative", f"Model warning: {w}"))

    score = round(float(max(1.0, min(10.0, score))), 1)

    if score >= 8:
        level, color = "High Confidence", "#10b981"
    elif score >= 6:
        level, color = "Moderate Confidence", "#f59e0b"
    elif score >= 4:
        level, color = "Low Confidence", "#f97316"
    else:
        level, color = "Very Low Confidence", "#ef4444"

    return {"score": score, "max": 10, "level": level, "color": color, "factors": factors}
