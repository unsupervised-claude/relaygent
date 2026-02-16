"""Input handlers for Linux computer-use: click, type, scroll, drag via xdotool."""
from __future__ import annotations

import subprocess
import time

# xdotool modifier key mapping (macOS names -> X11 names)
MOD_MAP = {"cmd": "ctrl", "alt": "alt", "ctrl": "ctrl", "shift": "shift"}

# Key name mapping (macOS/Hammerspoon names -> xdotool names)
KEY_MAP = {
    "return": "Return", "enter": "Return", "tab": "Tab",
    "escape": "Escape", "space": "space", "delete": "BackSpace",
    "forwarddelete": "Delete", "up": "Up", "down": "Down",
    "left": "Left", "right": "Right", "home": "Home", "end": "End",
    "pageup": "Prior", "pagedown": "Next",
}
for i in range(1, 13):
    KEY_MAP[f"f{i}"] = f"F{i}"


def _run(args: list[str], timeout: float = 5.0) -> str:
    r = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
    return r.stdout.strip()


def _xdotool(*args: str) -> str:
    return _run(["xdotool", *args])


def _mod_flags(modifiers: list[str] | None) -> list[str]:
    if not modifiers:
        return []
    return [MOD_MAP.get(m.lower(), m.lower()) for m in modifiers]


def click(params: dict) -> tuple[dict, int]:
    x, y = params.get("x"), params.get("y")
    if x is None or y is None:
        return {"error": "x,y required"}, 400

    _xdotool("mousemove", "--sync", str(int(x)), str(int(y)))

    mods = _mod_flags(params.get("modifiers"))
    for m in mods:
        _xdotool("keydown", m)

    if params.get("right"):
        _xdotool("click", "3")
    elif params.get("double"):
        _xdotool("click", "--repeat", "2", "--delay", "50", "1")
    else:
        _xdotool("click", "1")

    for m in reversed(mods):
        _xdotool("keyup", m)

    return {"clicked": {"x": x, "y": y, "modifiers": params.get("modifiers")}}, 200


def type_input(params: dict) -> tuple[dict, int]:
    text = params.get("text")
    key = params.get("key")
    modifiers = params.get("modifiers")

    if text:
        _xdotool("type", "--clearmodifiers", "--delay", "12", text)
        return {"typed": len(text)}, 200
    elif key:
        xkey = KEY_MAP.get(key.lower(), key)
        mods = _mod_flags(modifiers)
        if mods:
            combo = "+".join(mods + [xkey])
            _xdotool("key", "--clearmodifiers", combo)
        else:
            _xdotool("key", "--clearmodifiers", xkey)
        return {"key": key}, 200

    return {"error": "text or key required"}, 400


def scroll(params: dict) -> tuple[dict, int]:
    amount = params.get("amount", -3)
    reps = params.get("repeat", 1)

    if params.get("x") is not None and params.get("y") is not None:
        _xdotool("mousemove", "--sync",
                 str(int(params["x"])), str(int(params["y"])))

    # xdotool: button 4=up, 5=down; positive amount = scroll down
    button = "5" if amount > 0 else "4"
    clicks = abs(amount)

    for _ in range(int(reps)):
        _xdotool("click", "--repeat", str(clicks), "--delay", "20", button)
        if reps > 1:
            time.sleep(0.05)

    return {"scrolled": amount, "repeat": reps}, 200


def drag(params: dict) -> tuple[dict, int]:
    sx, sy = params.get("startX"), params.get("startY")
    ex, ey = params.get("endX"), params.get("endY")
    if None in (sx, sy, ex, ey):
        return {"error": "startX, startY, endX, endY required"}, 400

    steps = params.get("steps", 10)
    duration = params.get("duration", 0.3)
    step_delay = duration / max(steps, 1)

    _xdotool("mousemove", "--sync", str(int(sx)), str(int(sy)))
    _xdotool("mousedown", "1")

    for i in range(1, steps + 1):
        t = i / steps
        cx = sx + (ex - sx) * t
        cy = sy + (ey - sy) * t
        _xdotool("mousemove", "--sync", str(int(cx)), str(int(cy)))
        time.sleep(step_delay)

    _xdotool("mouseup", "1")
    return {"dragged": {"from": {"x": sx, "y": sy},
                        "to": {"x": ex, "y": ey}, "steps": steps}}, 200


def type_from_file(params: dict) -> tuple[dict, int]:
    path = params.get("path")
    if not path:
        return {"error": "path required"}, 400
    try:
        with open(path) as f:
            text = f.read().rstrip()
    except FileNotFoundError:
        return {"error": "file not found"}, 404

    _xdotool("type", "--clearmodifiers", "--delay", "12", text)
    return {"typed": len(text), "source": path}, 200
