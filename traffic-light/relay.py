#!/usr/bin/env python3
"""Cross-environment status relay for the agent traffic light.

Makes the light work for sessions running ANYWHERE -- local, cloud/web, or
another machine -- by using a private GitHub Gist as a shared status channel.
Each session writes its red/yellow/green to the gist; the light polls it.

This file is self-contained (standard library only) so it can be dropped into
any repo's hooks and reused by the light.

Config (both optional -- unconfigured = silent no-op so committing hooks is safe):
    TRAFFIC_LIGHT_GITHUB_TOKEN   a GitHub token WITH `gist` scope
    TRAFFIC_LIGHT_GIST_ID        the status gist's id
  or a JSON file ~/.agent-traffic-light/relay.json: {"token": "...", "gist_id": "..."}
  plus optional:
    TRAFFIC_LIGHT_LABEL          name for this environment (default: hostname, or "cloud")
    TRAFFIC_LIGHT_RELAY_STALE    seconds before a session is dropped (default 900)

CLI:
    python relay.py setup --token ghp_xxx    # create the gist, save config, print cloud env vars
    python relay.py set <red|yellow|green|off> [--source claude]
    python relay.py fetch                     # print aggregated status JSON
    python relay.py doctor                     # test connectivity/token from HERE
"""

from __future__ import annotations

import json
import os
import socket
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

API = "https://api.github.com"
RED, YELLOW, GREEN, OFF = "red", "yellow", "green", "off"
PRIORITY = {OFF: 0, GREEN: 1, YELLOW: 2, RED: 3}
ALIASES = {
    "red": RED, "coding": RED, "working": RED, "busy": RED, "running": RED,
    "yellow": YELLOW, "awaiting": YELLOW, "approval": YELLOW, "waiting": YELLOW,
    "notification": YELLOW, "input": YELLOW,
    "green": GREEN, "done": GREEN, "complete": GREEN, "idle": GREEN,
    "ready": GREEN, "connected": GREEN, "start": GREEN,
    "off": OFF, "disconnected": OFF, "end": OFF, "": OFF,
}
KEEPALIVE = "_keepalive.json"          # a gist must always keep >=1 file
PREFIX = "tl-"                          # session status files: tl-<label>-<sid>.json
DEFAULT_STALE = 900

BASE_DIR = Path(os.environ.get("AGENT_TRAFFIC_LIGHT_DIR",
                               str(Path.home() / ".agent-traffic-light"))).expanduser()
CONFIG_FILE = BASE_DIR / "relay.json"
CACHE_DIR = BASE_DIR / "relay-cache"

# Patch point for tests.
_urlopen = urllib.request.urlopen


# --------------------------------------------------------------------------- config
def load_config() -> dict:
    cfg = {}
    try:
        if CONFIG_FILE.exists():
            cfg = json.loads(CONFIG_FILE.read_text(encoding="utf-8") or "{}")
    except (OSError, ValueError):
        cfg = {}
    token = os.environ.get("TRAFFIC_LIGHT_GITHUB_TOKEN") or cfg.get("token")
    gist = os.environ.get("TRAFFIC_LIGHT_GIST_ID") or cfg.get("gist_id")
    return {"token": token, "gist_id": gist}


def is_configured() -> bool:
    c = load_config()
    return bool(c["token"] and c["gist_id"])


def save_config(token: str, gist_id: str) -> None:
    BASE_DIR.mkdir(parents=True, exist_ok=True)
    CONFIG_FILE.write_text(json.dumps({"token": token, "gist_id": gist_id}, indent=2),
                           encoding="utf-8")
    try:
        os.chmod(CONFIG_FILE, 0o600)
    except OSError:
        pass


def label() -> str:
    lbl = os.environ.get("TRAFFIC_LIGHT_LABEL")
    if lbl:
        return _safe(lbl)
    # Heuristic: cloud/CI environments rarely have a stable hostname the user knows.
    if os.environ.get("CLAUDE_CODE_REMOTE") or os.environ.get("CI"):
        return "cloud"
    try:
        return _safe(socket.gethostname().split(".")[0]) or "local"
    except Exception:
        return "local"


def _safe(s: str) -> str:
    return "".join(c for c in s if c.isalnum() or c in "-_")[:24]


def normalize(word: str) -> str:
    return ALIASES.get(str(word).strip().lower(), OFF)


def _stale() -> float:
    try:
        return float(os.environ.get("TRAFFIC_LIGHT_RELAY_STALE", DEFAULT_STALE))
    except ValueError:
        return DEFAULT_STALE


# --------------------------------------------------------------------------- http
def api(method: str, path: str, token: str, data=None, timeout: float = 15):
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(API + path, data=body, method=method, headers={
        "User-Agent": "agent-traffic-light",
        "Accept": "application/vnd.github+json",
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
    })
    with _urlopen(req, timeout=timeout) as r:
        raw = r.read()
        return r.status, (json.loads(raw) if raw else {})


# --------------------------------------------------------------------------- session key
def _stdin_session() -> str:
    try:
        if sys.stdin is None or sys.stdin.isatty():
            return ""
        if os.name == "posix":
            import select
            if not select.select([sys.stdin], [], [], 0.1)[0]:
                return ""
        raw = sys.stdin.read()
        return str(json.loads(raw).get("session_id", "")) if raw.strip() else ""
    except Exception:
        return ""


def _key(base_source: str) -> str:
    sid = _stdin_session()[:8]
    suffix = f"-{sid}" if sid else ""
    return f"{PREFIX}{_safe(label())}-{_safe(base_source)}{suffix}.json"


# --------------------------------------------------------------------------- push / fetch
def push(base_source: str, state: str) -> bool:
    """Report a state to the gist. Returns True if a network write happened.
    Never raises."""
    cfg = load_config()
    if not (cfg["token"] and cfg["gist_id"]):
        return False
    norm = normalize(state)
    key = _key(base_source)
    # Only hit the network on an actual transition (keeps it fast + rate-limit safe).
    cache = CACHE_DIR / key
    try:
        if cache.exists() and cache.read_text(encoding="utf-8").strip() == norm:
            return False
    except OSError:
        pass

    payload = json.dumps({"state": norm, "ts": time.time(), "label": label(),
                          "source": base_source})
    files = {key: None} if norm == OFF else {key: {"content": payload}}
    try:
        api("PATCH", f"/gists/{cfg['gist_id']}", cfg["token"], {"files": files})
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        (CACHE_DIR / key).write_text(norm, encoding="utf-8")
        return True
    except Exception as e:
        sys.stderr.write(f"traffic-light relay: push failed: {e}\n")
        return False


def parse_gist_files(gist: dict) -> list[tuple[str, str, float]]:
    """(label/source, state, ts) for each session file in a gist payload."""
    out = []
    for name, meta in (gist.get("files") or {}).items():
        if not name.startswith(PREFIX):
            continue
        content = (meta or {}).get("content") or ""
        try:
            d = json.loads(content)
            out.append((d.get("label") or d.get("source") or name,
                        normalize(d.get("state", OFF)), float(d.get("ts", 0))))
        except (ValueError, TypeError):
            continue
    return out


def summarize(entries: list[tuple[str, str, float]]) -> dict:
    now = time.time()
    stale = _stale()
    best, sources = OFF, []
    for src, state, ts in entries:
        if state == OFF:
            continue
        if stale > 0 and ts and (now - ts) > stale:
            continue
        sources.append(src)
        if PRIORITY[state] > PRIORITY[best]:
            best = state
    return {"state": best, "count": len(sources), "sources": sorted(set(sources))}


def fetch() -> dict:
    """Aggregate status from the gist. Returns {state,count,sources}. Never raises."""
    cfg = load_config()
    if not (cfg["token"] and cfg["gist_id"]):
        return {"state": OFF, "count": 0, "sources": []}
    try:
        _, gist = api("GET", f"/gists/{cfg['gist_id']}", cfg["token"])
        return summarize(parse_gist_files(gist))
    except Exception:
        return {"state": OFF, "count": 0, "sources": []}


# --------------------------------------------------------------------------- setup / doctor
def setup(token: str) -> str:
    """Create the status gist and save config. Returns the gist id. Raises on
    error (used by the CLI and the setup wizard)."""
    _, gist = api("POST", "/gists", token, {
        "description": "Agent Traffic Light status (do not delete)",
        "public": False,
        "files": {KEEPALIVE: {"content": "{}"}},
    })
    gid = gist["id"]
    save_config(token, gid)
    return gid


def cmd_setup(token: str) -> int:
    if not token:
        token = os.environ.get("TRAFFIC_LIGHT_GITHUB_TOKEN", "")
    if not token:
        print("Provide a GitHub token with `gist` scope:  "
              "python relay.py setup --token ghp_xxx")
        print("Create one at https://github.com/settings/tokens (classic, scope: gist)")
        return 2
    try:
        gid = setup(token)
    except urllib.error.HTTPError as e:
        print(f"Could not create gist: HTTP {e.code} {e.read()[:200]!r}")
        print("Make sure the token has the `gist` scope.")
        return 1
    except Exception as e:
        print(f"Could not create gist: {e}")
        return 1
    print("\n✅ Relay ready. Saved to", CONFIG_FILE)
    print(f"   Gist: https://gist.github.com/{gid}")
    print("\nTo light up CLOUD / web sessions, add these to your cloud environment's")
    print("variables (code.claude.com/docs -> environment variables):")
    print(f"   TRAFFIC_LIGHT_GITHUB_TOKEN = {token[:7]}… (your token)")
    print(f"   TRAFFIC_LIGHT_GIST_ID      = {gid}")
    print("\nThen run the light normally -- it now shows every environment.")
    return 0


def cmd_doctor() -> int:
    cfg = load_config()
    print("Traffic-light relay doctor")
    print(f"  label:   {label()}")
    print(f"  token:   {'set' if cfg['token'] else 'MISSING'}")
    print(f"  gist_id: {cfg['gist_id'] or 'MISSING'}")
    if not (cfg["token"] and cfg["gist_id"]):
        print("  -> not configured here. Set TRAFFIC_LIGHT_GITHUB_TOKEN and "
              "TRAFFIC_LIGHT_GIST_ID (or run setup).")
        return 2
    try:
        api("GET", "/user", cfg["token"])
        print("  auth:    OK (token accepted)")
    except Exception as e:
        print(f"  auth:    FAILED ({e})")
        return 1
    ok = push("doctor", "green")
    print(f"  write:   {'OK (pushed test status)' if ok else 'no-op/failed'}")
    got = fetch()
    print(f"  read:    state={got['state']} count={got['count']} sources={got['sources']}")
    push("doctor", "off")
    print("  -> relay works from this environment \U0001f7e2")
    return 0


def main() -> int:
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        return 0
    cmd = args[0]
    rest = args[1:]
    if cmd == "setup":
        tok = rest[rest.index("--token") + 1] if "--token" in rest else ""
        return cmd_setup(tok)
    if cmd == "doctor":
        return cmd_doctor()
    if cmd == "fetch":
        print(json.dumps(fetch()))
        return 0
    if cmd == "set":
        source = "claude"
        if "--source" in rest:
            i = rest.index("--source")
            source = rest[i + 1] if i + 1 < len(rest) else source
            rest = rest[:i] + rest[i + 2:]
        state = rest[0] if rest else "off"
        push(source, state)
        return 0
    print(f"unknown command: {cmd}")
    return 2


if __name__ == "__main__":
    sys.exit(main())
