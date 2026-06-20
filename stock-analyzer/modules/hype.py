import pandas as pd
import numpy as np


def calculate_hype_score(stock_data: dict) -> dict:
    """
    Calculate a 0-100 hype/popularity score from available market data.
    Returns score, level label, color, emoji, and per-component breakdown.
    """
    info = stock_data.get("info", {})
    history = stock_data.get("history_1y", pd.DataFrame())
    news = stock_data.get("news", [])

    components = {}
    total = 0.0

    # ── Component 1: Volume Activity (0–30 pts) ───────────────────────────
    current_vol = info.get("volume") or info.get("regularMarketVolume", 0) or 0
    avg_vol = info.get("averageVolume", 1) or 1
    if current_vol > 0 and avg_vol > 0:
        ratio = current_vol / avg_vol
        # 15 pts at 1x average, 30 pts at 2x+
        vol_score = float(np.clip((ratio - 1) * 15 + 15, 0, 30))
        detail = f"{ratio:.1f}× average volume"
    else:
        vol_score = 15.0
        detail = "Volume data unavailable"
    components["Trading Volume"] = {"score": vol_score, "max": 30, "detail": detail}
    total += vol_score

    # ── Component 2: News Activity (0–20 pts) ────────────────────────────
    news_count = len(news)
    news_score = float(np.clip(news_count * 2.0, 0, 20))
    components["News Activity"] = {
        "score": news_score, "max": 20,
        "detail": f"{news_count} recent articles",
    }
    total += news_score

    # ── Component 3: Price Momentum (0–20 pts) ───────────────────────────
    if not history.empty and len(history) >= 21:
        try:
            cp = history["Close"].iloc[-1]
            p1m = history["Close"].iloc[-21]
            p3m = history["Close"].iloc[-63] if len(history) >= 63 else history["Close"].iloc[0]
            m1 = (cp - p1m) / p1m
            m3 = (cp - p3m) / p3m
            blended = 0.6 * m1 + 0.4 * m3
            # 10 pts at 0% momentum, +/- 10 pts per +/- 10% move
            mom_score = float(np.clip(blended * 100 + 10, 0, 20))
            mom_detail = f"{m1*100:+.1f}% (1-month)"
        except Exception:
            mom_score = 10.0
            mom_detail = "Calculation error"
    else:
        mom_score = 10.0
        mom_detail = "Insufficient history"
    components["Price Momentum"] = {"score": mom_score, "max": 20, "detail": mom_detail}
    total += mom_score

    # ── Component 4: Short Interest / Market Attention (0–15 pts) ────────
    short_ratio = info.get("shortRatio")
    short_pct = info.get("shortPercentOfFloat")
    if short_ratio is not None and short_ratio > 0:
        att_score = float(np.clip(short_ratio * 1.5, 0, 15))
        att_detail = f"{short_ratio:.1f} days to cover"
    elif short_pct is not None:
        att_score = float(np.clip(short_pct * 100 * 1.5, 0, 15))
        att_detail = f"{short_pct*100:.1f}% of float shorted"
    else:
        att_score = 7.5
        att_detail = "Short data unavailable"
    components["Market Attention"] = {"score": att_score, "max": 15, "detail": att_detail}
    total += att_score

    # ── Component 5: Analyst Coverage (0–15 pts) ─────────────────────────
    analyst_count = info.get("numberOfAnalystOpinions", 0) or 0
    rec = (info.get("recommendationKey") or "").lower()
    # More analysts = more attention; bullish rec adds a little
    cov_score = float(np.clip(analyst_count * 0.5, 0, 12))
    if rec in ("buy", "strong_buy"):
        cov_score = min(15, cov_score + 3)
    cov_detail = f"{analyst_count} analysts · {rec.replace('_', ' ').title() if rec else 'N/A'}"
    components["Analyst Coverage"] = {"score": cov_score, "max": 15, "detail": cov_detail}
    total += cov_score

    score = float(np.clip(total, 0, 100))

    if score >= 80:
        level, color, emoji = "Extremely Hot", "#ef4444", "🔥"
    elif score >= 60:
        level, color, emoji = "Hot", "#f97316", "📈"
    elif score >= 40:
        level, color, emoji = "Warm", "#f59e0b", "📊"
    elif score >= 20:
        level, color, emoji = "Cool", "#3b82f6", "📉"
    else:
        level, color, emoji = "Cold", "#6b7280", "❄️"

    return {
        "score": score,
        "level": level,
        "color": color,
        "emoji": emoji,
        "components": components,
    }
