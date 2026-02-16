# Relaygent

An autonomous AI agent that runs continuously on your Mac (or its on Mac Mini). It can see your screen, click, type, read and write files, run commands, and hand off to itself indefinitely — no human in the loop required.

Built as a wrapper around [Claude Code](https://docs.anthropic.com/en/docs/claude-code). When one session fills its context window, it writes a detailed briefing and a fresh session picks up exactly where it left off. The result is an agent that runs for hours, days, or weeks — building software, managing systems, and evolving its own knowledge base over time.

You get a live web dashboard to watch it work, a chat interface to talk to it, and full computer control via Hammerspoon.

## Quick Start

```bash
git clone https://github.com/unsupervised-claude/relaygent.git
cd relaygent
./setup.sh
```

Setup handles everything: dependency installation, hub build, Hammerspoon configuration, and Claude CLI authentication. After setup:

```bash
relaygent start     # Launch the agent + dashboard + services
relaygent stop      # Stop everything
relaygent status    # Check what's running
relaygent restart   # Restart all services
relaygent logs      # Tail service logs
relaygent orient    # Quick system status snapshot
```

Open `http://localhost:8080` to watch your agent work.

## What It Does

**Runs autonomously.** The relay harness starts a Claude Code session, monitors it, and when context fills to ~85%, the agent writes a handoff and a successor session continues seamlessly. No manual intervention needed.

**Controls your Mac.** Via Hammerspoon, the agent can take screenshots, click buttons, type text, scroll, read accessibility trees, launch apps, and navigate Chrome. You can watch it live on the dashboard.

**Remembers everything.** A git-tracked knowledge base persists across sessions. The agent reads its predecessor's notes, updates them, and leaves better ones for the next session. Topics link together with wiki-links.

**Sleeps and wakes.** Between active work, the agent sleeps at zero token cost. When you send a chat message, a reminder fires, or a notification arrives — it wakes up and gets to work.

**Stays aligned.** You write an intent file describing your priorities. The agent reads it every session but can never edit it. You stay in control of *what* it works on.

## Requirements

- **macOS** (computer-use requires Hammerspoon, which is macOS-only)
- **Node.js 20+**
- **Python 3.9+**
- **Claude Code** (`npm install -g @anthropic-ai/claude-code`) with an active subscription

Setup will install Hammerspoon via Homebrew if needed and guide you through granting the required macOS permissions (Accessibility + Screen Recording).

## The Dashboard

A SvelteKit web app at `http://localhost:8080` with live updates via WebSocket:

- **Activity Feed** — every tool call the agent makes, in real time, with expandable details
- **Screen** — collapsible live view of what the agent sees (via Hammerspoon screenshots)
- **Chat** — message your agent directly; messages wake it from sleep
- **Knowledge Base** — browse the agent's long-term memory (Markdown + wiki-links)
- **Forum** — threaded discussions that persist across session handoffs
- **Intent** — your priorities file, visible to the agent, editable only by you
- **Context Bar** — how full the current session's context window is

## How the Relay Works

1. The harness starts a Claude Code session with a system prompt
2. Claude works autonomously — reading files, writing code, running commands, using the screen
3. A **PostToolUse hook** fires after every tool call, injecting current time, notifications, and context usage
4. At ~85% context, the agent wraps up: writes a handoff, updates persistent state, commits the KB
5. The harness spawns a **successor session** that reads the handoff and continues immediately
6. Between tasks, the agent **sleeps** — the harness polls for notifications and resumes the session when one arrives

## Hooks & Notifications

The agent stays aware of the outside world through a **PostToolUse hook** — a shell script that runs after every single tool call Claude makes. This is the agent's peripheral nervous system:

- **Current time** — injected every tool call so the agent always knows what time it is
- **Context tracking** — reads the session's JSONL to calculate context window fill %. At 85%, it injects a wrap-up warning telling the agent to write its handoff
- **Chat messages** — checks for unread messages from you. If you send a message via the dashboard, the agent sees it on its next tool call
- **Reminders** — the agent can set reminders for itself via MCP tools. When a reminder fires, the hook surfaces it

A background **notification poller** daemon runs alongside the agent, polling the notifications API every second and caching results to a temp file. The hook reads from this cache (instant, no HTTP call) rather than hitting the API directly — so it adds zero latency to tool calls.

When the agent sleeps, the harness takes over: it polls for pending notifications and resumes the Claude session when something arrives. The agent wakes up with the notification content injected as a message.

## Computer Use

The agent interacts with your Mac through 19 Hammerspoon-backed MCP tools:

- **Screenshots** — full screen or cropped regions, returned as inline images
- **Click / Type / Scroll** — precise input events with modifier key support
- **Accessibility tree** — find UI elements by role or title, click them programmatically
- **App management** — launch, focus, and list windows
- **Browser** — navigate Chrome to URLs
- **AppleScript** — run arbitrary AppleScript for deeper macOS integration

Every action auto-returns a screenshot so the agent sees the result immediately.

## Knowledge Base

The agent maintains a git-tracked knowledge base that grows over time:

| File | Purpose |
|------|---------|
| `handoff.md` | Detailed briefing for the next session (rewritten each handoff) |
| `working-state.md` | Persistent technical context (updated in place across sessions) |
| `intent.md` | Your priorities — the agent reads this but never edits it |
| `tasks.md` | Recurring and one-off task queue |
| `curiosities.md` | Open questions to explore when idle |
| `dead-ends.md` | Things tried that didn't work (so the agent doesn't repeat mistakes) |

Create additional topic files as needed. The agent links them together with `[[wiki-links]]`.

## Architecture

```
relaygent/
├── harness/          # Relay runner — session lifecycle, sleep/wake, handoff
├── hub/              # SvelteKit dashboard + chat + KB + forum (Node.js)
├── computer-use/     # MCP server wrapping Hammerspoon (19 tools)
├── hammerspoon/      # Lua scripts for screen control (copied to ~/.hammerspoon)
├── notifications/    # Reminder + wake trigger service (Python/Flask + MCP)
├── forum/            # Cross-session discussion board (Python/Flask)
├── hooks/            # PostToolUse hook (time, notifications, context tracking)
├── templates/        # Starter KB files for new installations
├── scripts/          # Pre-commit hook (200-line file limit enforcement)
└── bin/relaygent     # CLI (start/stop/status/restart/logs/orient)
```

## License

MIT
