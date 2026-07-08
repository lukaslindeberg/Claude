# Agent Traffic Light 🚦

A tiny, always-on-top desktop traffic light that shows what your AI coding
agent is doing — works with **Claude Code** and **OpenAI Codex**, and
automatically shows whichever one is active right now.

| Light | Meaning |
|-------|---------|
| 🟢 **Green** | Connected & idle — **turns on the moment an agent connects**, and when it's done |
| 🟡 **Yellow** | Awaiting your approval or input |
| 🔴 **Red** | Coding / working (running tools, editing files) |
| ⚫ **Off** | Nothing connected |

It **scales to any number of agents and concurrent sessions**: each session
registers itself, and the light shows an aggregate — **red** if *anyone* is
coding, else **yellow** if *anyone* needs you, else **green** if anything is
connected. A `● connected` indicator under the lamps shows how many agents are
live (e.g. `● 3: claude, codex`).

**Works everywhere — local *and* cloud/web sessions.** A local session lights
up instantly via a file on your machine; a session running in the cloud (Claude
Code on the web / a GitHub‑connected repo, on any machine) reports through a
shared private **GitHub Gist** that your light polls. One light, every
environment. See [Works everywhere](#works-everywhere-cloud--web-sessions).

It's pure Python standard library (tkinter) — no `pip install`, no
dependencies, a few MB of RAM and ~0% idle CPU (it only redraws when the
status actually changes).

```
Claude Code ─hooks──▶ ~/.agent-traffic-light/claude.state ┐
                                                          ├─▶ traffic_light.py
Codex ───────notify─▶ ~/.agent-traffic-light/codex.state  ┘   (shows newest)
```

Each agent writes its status to its own file; the window shows the one updated
**most recently**, so it follows whichever agent you're working with — and
labels it (`claude` / `codex`) underneath the lights.

## Requirements

- Python 3.8+
- **tkinter** (bundled with the python.org installer on Windows/macOS):
  - Debian/Ubuntu: `sudo apt install python3-tk`
  - Fedora: `sudo dnf install python3-tkinter`

## Quick start — one click

Double-click the launcher for your device, then click **“✓ Install & Start”**.
That's the whole setup: it installs the hooks, opens the light, and turns on
auto-start at login — one button.

| Device | Double-click |
|--------|--------------|
| **macOS** | `Install Traffic Light.command` *(first time: right-click → Open)* |
| **Windows** | `Install Traffic Light.bat` |
| **Linux** | `install.sh` *(or right-click → Run)* |

Then **restart Claude Code once** so it loads the hooks. That's it — the light
turns green when a session connects.

> **Updates never break it.** The app installs itself to a fixed location
> (`~/.agent-traffic-light/app/`) and the hooks point there — so you can delete
> the download, and re-downloading a newer version and clicking Install again
> just refreshes it without ever orphaning anything.
>
> After the first install you don't even need the download again — the setup
> window is always at `~/.agent-traffic-light/app/setup.py`.

No graphical toolkit? The same launcher falls back to a simple text menu.

### Or from the command line

```bash
python setup.py            # the same setup window / text menu
python install.py          # wire up both agents directly (installs to the fixed location)
#   python install.py --claude-only | --codex-only | --uninstall
python traffic_light.py --demo        # preview the look with no agent running
python traffic_light.py --scale 1.5   # bigger (good for high-DPI / TV displays)
```

## Using the window

- **Drag** it anywhere with the left mouse button.
- **Right-click**, or press **Esc** / **q**, to quit.
- Starts top-right of your primary screen and stays on top.
- **Resize** with `--scale 0.5`–`4.0` or the `AGENT_TRAFFIC_LIGHT_SCALE` env var.

## What each agent supports

### Claude Code — full lifecycle, per session
Installed as [hooks](https://docs.claude.com/en/docs/claude-code/hooks) in
`~/.claude/settings.json`. Each session's `session_id` is read from the hook
payload, so concurrent sessions light up independently:

| Hook | Light |
|------|-------|
| `SessionStart` | 🟢 green — **connected** (light turns on) |
| `UserPromptSubmit`, `PreToolUse` | 🔴 red |
| `Notification` | 🟡 yellow |
| `Stop` | 🟢 green (idle / done) |
| `SessionEnd` | ⚫ off — disconnected (light turns off) |

### Codex — green out of the box, red on demand
Codex's external `notify` program currently only receives the
`agent-turn-complete` event ([openai/codex#11808](https://github.com/openai/codex/issues/11808)),
so `install.py` wires `notify_codex.py` into `~/.codex/config.toml` to turn the
light 🟢 **green when a turn finishes** — the signal that tells you to look back
at the terminal.

- **Red while it works:** Codex doesn't emit a "started" event, so for one-shot
  runs wrap the command with `run_red.py` (red while running, green when done):

  ```bash
  python run_red.py codex -- codex exec "refactor the utils module"
  ```

  Handy as a shell alias for one-shot use:
  ```bash
  alias codex-go='python /path/to/run_red.py codex -- codex exec'
  ```

- **Yellow (approval):** Codex doesn't deliver approval-request events to
  external programs yet, so there's no automatic yellow for Codex. You can still
  get a desktop ping by adding `notifications = ["approval-requested"]` under
  `[tui]` in `config.toml`.
- **Disconnect:** Codex also has no session-end event, so a Codex turn that
  finished green will stay connected until the stale window passes (see below);
  Claude Code turns its light off immediately on `SessionEnd`.

## Works everywhere (cloud & web sessions)

Local hooks only fire for Claude running **on your Mac**. When you work in a
GitHub repo through Claude on the web, that session runs in the cloud and can't
touch your Mac — so the light stays dark. The relay fixes that using a private
**GitHub Gist** as a shared status channel that any environment can write to and
your light polls:

```
 cloud/web session ─┐
 another machine   ─┼─▶  private GitHub Gist  ◀─ polled by ─  traffic_light.py
 local session     ─┘        (status per session)                (your Mac)
```

**Easiest — the wizard:** in the setup window click **“☁ Cloud sessions”**. It
opens GitHub to the right token page, takes your pasted token, creates the gist,
copies the two environment variables to your clipboard, and (optionally) adds the
hooks to a repo folder you pick. Then paste those two variables into your cloud
environment's settings and you're done.

**Or do it by hand:**

1. Create a GitHub token with the **`gist`** scope:
   https://github.com/settings/tokens → *Generate new token (classic)* → tick
   **`gist`** → generate → copy the `ghp_…` value.
2. On your Mac, create the status gist and save the config:
   ```bash
   python relay.py setup --token ghp_xxxxxxxx
   ```
   It prints two values — `TRAFFIC_LIGHT_GITHUB_TOKEN` and
   `TRAFFIC_LIGHT_GIST_ID` — and saves them locally so your light starts polling.
3. Add the relay hooks to the repo you work on in the cloud, then commit & push:
   ```bash
   python install.py --relay-repo /path/to/your/repo
   ```
   This writes `.claude/settings.json` and a self‑contained
   `.claude/traffic-light/relay.py` into that repo.
4. In your **cloud environment's variables** (see
   [Claude Code on the web docs](https://code.claude.com/docs/en/claude-code-on-the-web)),
   set the two variables from step 2:
   `TRAFFIC_LIGHT_GITHUB_TOKEN` and `TRAFFIC_LIGHT_GIST_ID`.
5. Verify from inside a cloud session (or locally):
   ```bash
   python relay.py doctor
   ```
   It checks the token, does a test write, reads it back, and tells you if the
   relay works from that environment.

Now a cloud/web repo session turns your Mac's light red/green too (a few seconds
of polling delay). Local sessions stay instant. The light **merges both**, so
the count can read e.g. `● 2: cloud, local`.

Notes:
- The relay only makes network calls **on a state change** (transition‑cached),
  so it's light on rate limits.
- The committed relay hooks are a **safe no‑op** for anyone without the token —
  fine to commit to a shared repo.
- Requires the cloud environment to allow outbound HTTPS to `api.github.com`
  (governed by its network policy). `relay.py doctor` confirms this.

## Uninstall

```bash
python install.py --uninstall                 # local Claude Code + Codex
python install.py --relay-repo /path --uninstall   # relay hooks from a repo
```

## Customizing

- **State directory:** `~/.agent-traffic-light/` (one `*.state` file per
  agent/session). Override with `AGENT_TRAFFIC_LIGHT_DIR` for every script.
- **Scaling:** `--scale` / `AGENT_TRAFFIC_LIGHT_SCALE` (0.5–4.0).
- **Stale window:** idle (green) sessions older than `AGENT_TRAFFIC_LIGHT_STALE`
  seconds (default 12h) are treated as disconnected, so a crashed agent that
  never sent `SessionEnd` won't pin the light on forever.
- **Set a state by hand** (testing, or wiring a third agent):
  ```bash
  python set_state.py yellow --source myagent
  ```
- **Hook → color mapping:** edit `CLAUDE_EVENTS` in `install.py`, re-run install.
- **Colors, poll interval, position:** constants near the top of
  `traffic_light.py`.

## Files

| File | Purpose |
|------|---------|
| `Install Traffic Light.command` / `.bat`, `install.sh` | Clickable launchers (macOS / Windows / Linux). |
| `setup.py` | Clickable setup window (install, uninstall, start, start-at-login); text menu fallback. |
| `traffic_light.py` | The always-on-top window (run this; `--demo` to preview). |
| `agent_state.py` | Shared state read/write + "most recent agent" logic. |
| `set_state.py` | Helper the Claude Code hooks call. |
| `notify_codex.py` | Codex `notify` program (turn-complete → green). |
| `run_red.py` | Run a command red→green (gives Codex a "working" state). |
| `relay.py` | Cross-environment relay via a shared GitHub Gist (`setup`/`set`/`fetch`/`doctor`); makes cloud/web sessions light up. |
| `install.py` | Adds/removes the integration for both agents, and `--relay-repo` for cloud (used by `setup.py`). |
| `tests/test_relay.py` | Automated tests for the relay + aggregation logic (`python3 tests/test_relay.py`). |

## Notes

- The hooks/notify only write a single word to a file and exit; they never fail
  loudly, so they can't block or slow down your agent.
- Run several agents at once and the light always reflects the most recent
  activity across all of them.
