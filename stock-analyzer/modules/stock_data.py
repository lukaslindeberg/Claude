import yfinance as yf
import requests
import pandas as pd
import numpy as np
from datetime import datetime


def search_companies(query: str) -> list:
    """Search Yahoo Finance for companies matching query."""
    try:
        url = "https://query2.finance.yahoo.com/v1/finance/search"
        params = {
            "q": query,
            "quotesCount": 6,
            "newsCount": 0,
            "enableFuzzyQuery": True,
        }
        headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
        r = requests.get(url, params=params, headers=headers, timeout=10)
        if r.status_code == 200:
            quotes = r.json().get("quotes", [])
            results = []
            for q in quotes:
                if q.get("quoteType") in ("EQUITY", "ETF"):
                    results.append(
                        {
                            "symbol": q.get("symbol", ""),
                            "name": q.get("longname") or q.get("shortname", ""),
                            "exchange": q.get("exchDisp", ""),
                            "type": q.get("quoteType", ""),
                        }
                    )
            return results[:5]
    except Exception:
        pass
    return []


def get_comprehensive_data(ticker: str) -> dict | None:
    """Fetch all data needed for analysis from Yahoo Finance."""
    try:
        stock = yf.Ticker(ticker)
        info = stock.info

        if not info or not info.get("quoteType"):
            return None

        hist_1y = stock.history(period="1y")
        hist_2y = stock.history(period="2y")

        try:
            cashflow = stock.cashflow
        except Exception:
            cashflow = pd.DataFrame()

        try:
            financials = stock.financials
        except Exception:
            financials = pd.DataFrame()

        try:
            balance_sheet = stock.balance_sheet
        except Exception:
            balance_sheet = pd.DataFrame()

        try:
            news = stock.news[:15]
        except Exception:
            news = []

        return {
            "ticker": ticker,
            "info": info,
            "history_1y": hist_1y,
            "history_2y": hist_2y,
            "cashflow": cashflow,
            "financials": financials,
            "balance_sheet": balance_sheet,
            "news": news,
        }
    except Exception:
        return None


def get_key_metrics(stock_data: dict) -> dict:
    """Extract display-ready metrics from raw stock data."""
    info = stock_data.get("info", {})
    hist = stock_data.get("history_1y", pd.DataFrame())
    ticker = stock_data.get("ticker", "")

    m = {}

    # Price
    m["current_price"] = info.get("currentPrice") or info.get("regularMarketPrice", 0) or 0
    m["previous_close"] = info.get("previousClose") or info.get("regularMarketPreviousClose", 0) or 0
    if m["current_price"] and m["previous_close"]:
        m["price_change"] = m["current_price"] - m["previous_close"]
        m["price_change_pct"] = (m["price_change"] / m["previous_close"]) * 100
    else:
        m["price_change"] = 0
        m["price_change_pct"] = 0

    # Market
    m["market_cap"] = info.get("marketCap", 0) or 0
    m["enterprise_value"] = info.get("enterpriseValue", 0) or 0
    m["shares_outstanding"] = info.get("sharesOutstanding", 0) or 0

    # Valuation ratios
    m["pe_ratio"] = info.get("trailingPE")
    m["forward_pe"] = info.get("forwardPE")
    m["pb_ratio"] = info.get("priceToBook")
    m["ps_ratio"] = info.get("priceToSalesTrailing12Months")
    m["ev_ebitda"] = info.get("enterpriseToEbitda")

    # Financials
    m["revenue"] = info.get("totalRevenue", 0) or 0
    m["revenue_growth"] = info.get("revenueGrowth")
    m["gross_margin"] = info.get("grossMargins")
    m["operating_margin"] = info.get("operatingMargins")
    m["profit_margin"] = info.get("profitMargins")
    m["eps"] = info.get("trailingEps")
    m["forward_eps"] = info.get("forwardEps")

    # Balance sheet
    m["total_cash"] = info.get("totalCash", 0) or 0
    m["total_debt"] = info.get("totalDebt", 0) or 0
    m["debt_to_equity"] = info.get("debtToEquity")

    # Returns & risk
    m["roe"] = info.get("returnOnEquity")
    m["roa"] = info.get("returnOnAssets")
    m["beta"] = info.get("beta") or 1.0

    # Dividend
    m["dividend_yield"] = info.get("dividendYield")

    # 52-week
    m["week_52_high"] = info.get("fiftyTwoWeekHigh")
    m["week_52_low"] = info.get("fiftyTwoWeekLow")

    # Volume
    m["avg_volume"] = info.get("averageVolume", 0) or 0
    m["current_volume"] = info.get("volume") or info.get("regularMarketVolume", 0) or 0

    # Company info
    m["name"] = info.get("longName") or info.get("shortName") or ticker
    m["ticker"] = ticker
    m["sector"] = info.get("sector", "N/A")
    m["industry"] = info.get("industry", "N/A")
    m["country"] = info.get("country", "N/A")
    m["description"] = info.get("longBusinessSummary", "")
    m["website"] = info.get("website", "")

    # Analyst info
    m["recommendation"] = info.get("recommendationKey", "").replace("_", " ").title()
    m["analyst_count"] = info.get("numberOfAnalystOpinions", 0)
    m["target_price"] = info.get("targetMeanPrice")
    m["target_high"] = info.get("targetHighPrice")
    m["target_low"] = info.get("targetLowPrice")

    # Short interest
    m["short_ratio"] = info.get("shortRatio")
    m["short_percent"] = info.get("shortPercentOfFloat")

    # 1-year performance
    if not hist.empty and len(hist) >= 2:
        m["ytd_return"] = ((hist["Close"].iloc[-1] - hist["Close"].iloc[0]) / hist["Close"].iloc[0]) * 100
    else:
        m["ytd_return"] = None

    return m
