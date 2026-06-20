"""Ollama integration for AI-powered financial analysis + smart query parsing."""
from __future__ import annotations
import re

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
    """Return installed model names.

    Handles every shape the ``ollama`` client has shipped:
      • ≤0.3  →  ``{"models": [{"name": "llama3.2:latest", ...}]}``  (dict)
      • ≥0.4  →  ``ListResponse(models=[Model(model="llama3.2:latest", ...)])``
                 (pydantic objects — ``.get`` raises, field renamed to ``model``)
    """
    if not _OLLAMA_AVAILABLE:
        return []
    try:
        resp = _ollama.list()
    except Exception:
        return []

    # Normalise to a plain list of model entries.
    models_raw = getattr(resp, "models", None)
    if models_raw is None and isinstance(resp, dict):
        models_raw = resp.get("models", [])
    if not models_raw:
        return []

    names: list[str] = []
    for m in models_raw:
        name = None
        # pydantic Model objects: prefer .model, fall back to .name
        for attr in ("model", "name"):
            v = getattr(m, attr, None)
            if isinstance(v, str) and v:
                name = v
                break
        # legacy dict entries
        if name is None and isinstance(m, dict):
            name = m.get("model") or m.get("name")
        if name:
            names.append(name)
    return names


# ─── Smart query parsing ──────────────────────────────────────────────────────

_STOPWORDS = {
    "is", "are", "was", "were", "be", "been", "being",
    "the", "a", "an", "of", "for", "to", "in", "at", "on", "by", "with",
    "what", "why", "how", "when", "where", "which", "who",
    "can", "could", "would", "should", "will", "may", "might", "shall",
    "do", "does", "did", "have", "had", "has",
    "i", "me", "my", "we", "our", "you", "your", "they", "them", "their",
    "this", "that", "these", "those",
    "please", "tell", "show", "give", "find", "get", "want", "need",
    "analyze", "analysis", "analyse", "dcf", "value", "valuation", "intrinsic",
    "worth", "fair", "buy", "sell", "hold", "stock", "share", "price",
    "overvalued", "undervalued", "model", "estimate", "forecast",
    "fundamental", "target", "report", "current", "latest", "now",
}


def extract_company_from_query(query: str, model: str | None = None) -> str:
    """
    Extract the company name or ticker from a natural-language query.
    Uses Ollama when available, falls back to keyword heuristic.
    """
    q = query.strip()

    # Pure ticker pattern (e.g. AAPL, NVDA, BRK.B, ASML.AS)
    if re.match(r"^[A-Z]{1,5}(\.[A-Z]{1,2})?$", q):
        return q

    # Ollama extraction
    if model and _OLLAMA_AVAILABLE:
        try:
            resp = _ollama.chat(
                model=model,
                messages=[{
                    "role": "user",
                    "content": (
                        "Extract ONLY the company name or stock ticker from the query below. "
                        "Reply with the name only — no explanation, no punctuation.\n"
                        f'Query: "{q}"'
                    ),
                }],
                options={"temperature": 0, "num_predict": 20},
            )
            extracted = resp["message"]["content"].strip().strip("\"'.,!?")
            if extracted and 1 < len(extracted) < 60:
                return extracted
        except Exception:
            pass

    # Keyword-strip fallback
    words = re.sub(r"[^\w\s]", " ", q).split()
    clean = [w for w in words if w.lower() not in _STOPWORDS and len(w) > 1]
    # Prefer longer words (company names) over short function words
    clean.sort(key=len, reverse=True)
    return " ".join(clean[:3]) if clean else q


# ─── Streaming chat helper ────────────────────────────────────────────────────

def _stream(model: str, system: str, user: str):
    msgs = []
    if system:
        msgs.append({"role": "system", "content": system})
    msgs.append({"role": "user", "content": user})
    try:
        for chunk in _ollama.chat(model=model, messages=msgs, stream=True):
            c = chunk.get("message", {}).get("content", "")
            if c:
                yield c
    except Exception as e:
        yield f"\n\n⚠️  Ollama error: {e}"


# ─── DCF Narrative ────────────────────────────────────────────────────────────

def generate_dcf_narrative(key_metrics: dict, dcf: dict, model: str):
    """Stream a professional 3-stage DCF report tailored to the data quality."""
    name    = key_metrics.get("name", "the company")
    ticker  = key_metrics.get("ticker", "")
    sector  = key_metrics.get("sector", "N/A")
    rev     = key_metrics.get("revenue", 0) or 0
    op_m    = key_metrics.get("operating_margin") or 0

    fcf     = dcf.get("current_fcf", 0)
    ttm     = dcf.get("ttm_fcf")
    iv      = dcf.get("intrinsic_value", 0)
    cp      = dcf.get("current_price", 0)
    upside  = dcf.get("upside_pct", 0)
    wacc    = dcf.get("wacc_data", {}).get("wacc", 0.10)
    beta    = dcf.get("wacc_data", {}).get("beta", 1.0)
    tax     = dcf.get("wacc_data", {}).get("tax_rate", 0.21)
    tg      = dcf.get("assumptions", {}).get("terminal_growth", 0.025)
    cagr    = dcf.get("growth_rates", {}).get("cagr", 0.10)
    analst  = dcf.get("growth_rates", {}).get("analyst_growth")
    s1_g    = dcf.get("projection", {}).get("stage1_growth", cagr)
    proj    = dcf.get("projected_fcf", [])
    ev      = dcf.get("enterprise_value", 0)
    nd      = dcf.get("net_debt", 0)
    tv_pct  = dcf.get("pv_terminal_pct", 0)
    src     = dcf.get("data_source", "calculated")
    warns   = dcf.get("warnings", [])
    rev_g   = dcf.get("reverse_dcf_growth")
    mc      = dcf.get("monte_carlo")
    mults   = dcf.get("multiples", {})

    proj_str = ", ".join(f"Yr{i+1}: ${v/1e9:.2f}B" for i, v in enumerate(proj[:5]))
    mc_str   = (f"P10=${mc['p10']:.2f} / P50=${mc['p50']:.2f} / P90=${mc['p90']:.2f}"
                if mc else "N/A")
    comp_str = (f"${mults['composite']:.2f}" if mults and mults.get("composite") else "N/A")
    rev_str  = (f"{rev_g*100:.1f}% implied annual growth" if rev_g is not None
                else "Not computable (negative FCF)")
    analst_str = f"{analst*100:.1f}%" if analst is not None else "not available"

    system = (
        "You are a senior equity research analyst at a leading investment bank. "
        "Write rigorous, data-driven valuation reports that are precise and balanced. "
        "Never give direct buy/sell advice — present analysis only."
    )

    user = f"""Write a professional DCF analysis report for {name} ({ticker}).

KEY DATA:
  Sector: {sector} | Revenue: ${rev/1e9:.2f}B | Operating margin: {op_m*100:.1f}%
  FCF (latest annual): ${fcf/1e9:.2f}B | FCF (TTM): {f"${ttm/1e9:.2f}B" if ttm else "N/A"}
  FCF data source: {src}

3-STAGE DCF MODEL (10-year projection):
  Stage-1 growth (yrs 1-5): {s1_g*100:.1f}%
  Historical FCF CAGR: {cagr*100:.1f}% | Analyst consensus growth: {analst_str}
  Stage-2 growth (yrs 6-10): Fading to terminal
  Terminal growth: {tg*100:.1f}%
  Stage-1 FCF projections: {proj_str}

WACC: {wacc*100:.2f}% | Beta: {beta:.2f} | Effective tax rate: {tax*100:.1f}%
Enterprise value: ${ev/1e9:.2f}B | Net debt: ${nd/1e9:.2f}B
Terminal value as % of EV: {tv_pct:.0f}%

VALUATION RESULTS:
  DCF intrinsic value: ${iv:.2f} | Market price: ${cp:.2f} | Upside: {upside:+.1f}%
  Reverse DCF: {rev_str}
  Monte Carlo P10/P50/P90: {mc_str}
  Sector-multiples composite: {comp_str}

MODEL NOTES: {'; '.join(warns) if warns else 'None'}

Write a report with these exact section headers:
## Executive Summary
## Business & Financial Overview
## DCF Model: Assumptions & Methodology
## Sensitivity & Risk Analysis
## Valuation Conclusion

Use specific numbers from the data above. 500–700 words. Professional tone."""

    yield from _stream(model, system, user)


# ─── News Sentiment ───────────────────────────────────────────────────────────

def analyze_news_sentiment(news_items: list, company_name: str, model: str):
    if not news_items:
        yield "No recent news articles found for analysis."
        return

    headlines = "\n".join(
        f"• {n.get('title','No title')} — {n.get('publisher','Unknown')}"
        for n in news_items[:12]
    )

    user = f"""Analyse these recent headlines for {company_name} from an investment perspective.

HEADLINES:
{headlines}

Provide exactly:
**Overall Sentiment:** [Bullish / Bearish / Mixed / Neutral] — one sentence why

**Key Themes** (up to 3 bullets):
-
-

**Potential Price Impact:** 2 sentences

**Investor Watch Points** (2 bullets):
-
-

Be concise. Focus on investment relevance only."""

    yield from _stream(model, "", user)


# ─── Valuation Gap Analysis ───────────────────────────────────────────────────

def analyze_valuation_gap(dcf: dict, key_metrics: dict, model: str):
    iv        = dcf.get("intrinsic_value", 0)
    cp        = dcf.get("current_price", 0)
    upside    = dcf.get("upside_pct", 0)
    rev_g     = dcf.get("reverse_dcf_growth")
    mc        = dcf.get("monte_carlo")
    mults     = dcf.get("multiples", {})
    name      = key_metrics.get("name", "the company")
    sector    = key_metrics.get("sector", "N/A")

    status = ("POTENTIALLY UNDERVALUED" if upside > 15
              else ("POTENTIALLY OVERVALUED" if upside < -15 else "FAIRLY VALUED"))

    mults_str = ""
    if mults.get("pe_value"):
        mults_str += f"\n  P/E implied: ${mults['pe_value']:.2f}"
    if mults.get("ev_ebitda_value"):
        mults_str += f"\n  EV/EBITDA implied: ${mults['ev_ebitda_value']:.2f}"
    if mults.get("composite"):
        mults_str += f"\n  Multiples composite: ${mults['composite']:.2f}"

    mc_str = (f"P10=${mc['p10']:.2f} → P50=${mc['p50']:.2f} → P90=${mc['p90']:.2f}"
              if mc else "N/A")
    rev_str = (f"Market implies {rev_g*100:.1f}% annual FCF growth for 10 years"
               if rev_g is not None else "Not available")

    user = f"""Explain the valuation gap for {name} (sector: {sector}).

DCF intrinsic value: ${iv:.2f} | Market price: ${cp:.2f} | Gap: {upside:+.1f}% — {status}
Reverse DCF: {rev_str}
Monte Carlo range: {mc_str}
Alternative methods:{mults_str if mults_str else " N/A"}

Write exactly three focused paragraphs with these bold headers:
**Why This Gap Exists**
**What the Market May Be Pricing In**
**What an Investor Should Consider**

Be specific, balanced, and data-grounded. No direct buy/sell advice."""

    yield from _stream(model, "", user)


# ─── Confidence Score ─────────────────────────────────────────────────────────

def calculate_confidence_score(dcf: dict, key_metrics: dict) -> dict:
    score = 5.0
    factors: list[tuple[str, str]] = []

    src = dcf.get("data_source", "estimated")
    if src == "quarterly_ttm":
        score += 2.0; factors.append(("positive", "TTM FCF from quarterly data — most current"))
    elif src == "direct":
        score += 1.5; factors.append(("positive", "Direct FCF from annual cash flow statement"))
    elif src == "calculated":
        score += 0.8; factors.append(("positive", "FCF derived from operating CF minus CapEx"))
    elif src in ("operating_cf", "quarterly_op_only"):
        score += 0.2; factors.append(("neutral",  "Operating CF used as proxy (CapEx missing)"))
    else:
        score -= 1.5; factors.append(("negative", "FCF estimated from margins — low accuracy"))

    if (dcf.get("current_fcf") or 0) > 0:
        score += 0.8; factors.append(("positive", "Positive free cash flow — DCF directly applicable"))
    else:
        score -= 2.0; factors.append(("negative", "Negative FCF — model accuracy is reduced"))

    stab = dcf.get("growth_rates", {}).get("stability", "low")
    if stab == "high":
        score += 1.2; factors.append(("positive", "Highly stable and predictable cash flows"))
    elif stab == "medium":
        score += 0.5; factors.append(("neutral",  "Moderately stable cash flows"))
    else:
        score -= 0.5; factors.append(("negative", "Variable cash flows reduce model reliability"))

    if dcf.get("growth_rates", {}).get("analyst_growth") is not None:
        score += 0.6; factors.append(("positive", "Analyst consensus growth data available"))
    else:
        factors.append(("neutral", "No analyst growth estimates — using historical only"))

    if dcf.get("monte_carlo"):
        score += 0.3; factors.append(("positive", "Monte Carlo simulation completed successfully"))

    tv_pct = dcf.get("pv_terminal_pct", 50)
    if tv_pct > 80:
        score -= 1.0; factors.append(("negative", f"Terminal value = {tv_pct:.0f}% of EV — highly assumption-sensitive"))
    elif tv_pct > 65:
        score -= 0.4; factors.append(("neutral",  f"Terminal value = {tv_pct:.0f}% of EV — moderate sensitivity"))
    else:
        score += 0.3; factors.append(("positive", f"Terminal value = {tv_pct:.0f}% of EV — well-anchored"))

    n_analysts = key_metrics.get("analyst_count") or 0
    if n_analysts >= 10:
        score += 0.5; factors.append(("positive", f"{n_analysts} analysts cover this stock"))
    elif n_analysts >= 3:
        score += 0.2; factors.append(("neutral",  f"{n_analysts} analysts cover this stock"))
    else:
        score -= 0.3; factors.append(("negative", "Minimal analyst coverage — less external validation"))

    for w in dcf.get("warnings", []):
        score -= 0.4; factors.append(("negative", f"Model warning: {w}"))

    score = round(float(max(1.0, min(10.0, score))), 1)

    if   score >= 8: level, color = "High Confidence",      "#10b981"
    elif score >= 6: level, color = "Moderate Confidence",  "#f59e0b"
    elif score >= 4: level, color = "Low Confidence",       "#f97316"
    else:            level, color = "Very Low Confidence",  "#ef4444"

    return {"score": score, "max": 10, "level": level, "color": color, "factors": factors}
