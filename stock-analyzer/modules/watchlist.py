"""
Watchlist persistence — lightweight, dependency-free.

Run locally, saved companies live in a JSON file next to the app so the list
survives reloads and restarts. Hosted as a website, every visitor would share
that file, so the list is kept per visitor in their browser session instead.
"""
import json
from datetime import datetime
from pathlib import Path

import streamlit as st

from modules.hosting import HOSTED

_PATH = Path(__file__).parent.parent / "data" / "watchlist.json"


def _read() -> list[dict]:
    if HOSTED:
        return list(st.session_state.get("_watchlist_items", []))
    try:
        if _PATH.exists():
            data = json.loads(_PATH.read_text())
            if isinstance(data, list):
                return data
    except Exception:
        pass
    return []


def _write(items: list[dict]) -> None:
    if HOSTED:
        st.session_state["_watchlist_items"] = items
        return
    try:
        _PATH.parent.mkdir(parents=True, exist_ok=True)
        _PATH.write_text(json.dumps(items, indent=2))
    except Exception:
        pass


def load_watchlist() -> list[dict]:
    """Return saved companies, most-recently-added first."""
    return _read()


def is_watched(ticker: str) -> bool:
    if not ticker:
        return False
    t = ticker.upper()
    return any(i.get("ticker", "").upper() == t for i in _read())


def add_to_watchlist(ticker: str, name: str) -> None:
    if not ticker:
        return
    items = _read()
    t = ticker.upper()
    if any(i.get("ticker", "").upper() == t for i in items):
        return
    items.insert(0, {
        "ticker": ticker,
        "name": name or ticker,
        "added": datetime.now().strftime("%Y-%m-%d"),
    })
    _write(items)


def remove_from_watchlist(ticker: str) -> None:
    if not ticker:
        return
    t = ticker.upper()
    _write([i for i in _read() if i.get("ticker", "").upper() != t])
