"""Display handlers for Linux: screenshot, windows, apps, focus, launch."""
from __future__ import annotations

import subprocess


def _run(args, timeout=5):
    r = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
    return r.stdout.strip()


def screen_size() -> tuple[int, int]:
    """Get screen resolution via xdpyinfo or xrandr."""
    try:
        out = _run(["xdpyinfo"])
        for line in out.splitlines():
            if "dimensions:" in line:
                w, h = line.split()[1].split("x")
                return int(w), int(h)
    except Exception:
        pass
    try:
        out = _run(["xrandr", "--current"])
        for line in out.splitlines():
            if " connected" in line:
                for part in line.split():
                    if "x" in part and "+" in part:
                        w, h = part.split("+")[0].split("x")
                        return int(w), int(h)
    except Exception:
        pass
    return 1920, 1080


def screenshot(params: dict) -> tuple[dict, int]:
    path = params.get("path", "/tmp/claude-screenshot.png")
    x, y = params.get("x"), params.get("y")
    w, h = params.get("w"), params.get("h")

    if x is not None and y is not None and w is not None and h is not None:
        _run(["scrot", "-o", path])
        crop = f"{int(w)}x{int(h)}+{int(x)}+{int(y)}"
        _run(["convert", path, "-crop", crop, "+repage", path])
        return {"path": path, "width": int(w), "height": int(h),
                "crop": {"x": x, "y": y, "w": w, "h": h}}, 200

    _run(["scrot", "-o", path])

    ix, iy = params.get("indicator_x"), params.get("indicator_y")
    if ix is not None and iy is not None:
        _run(["convert", path,
              "-fill", "none", "-stroke", "red", "-strokewidth", "3",
              "-draw", f"circle {int(ix)},{int(iy)} {int(ix)+18},{int(iy)}",
              "-fill", "red", "-stroke", "none",
              "-draw", f"circle {int(ix)},{int(iy)} {int(ix)+3},{int(iy)}",
              path])

    sw, sh = screen_size()
    return {"path": path, "width": sw, "height": sh}, 200


def windows(_params: dict) -> tuple[dict, int]:
    wins = []
    try:
        out = _run(["wmctrl", "-l", "-G", "-p"])
        for line in out.splitlines():
            parts = line.split(None, 8)
            if len(parts) >= 8:
                wid = parts[0]
                x, y, w, h = int(parts[3]), int(parts[4]), int(parts[5]), int(parts[6])
                title = parts[8] if len(parts) > 8 else ""
                wins.append({"id": wid, "title": title, "app": "",
                             "frame": {"x": x, "y": y, "w": w, "h": h},
                             "focused": False})
    except Exception:
        pass
    try:
        active = _run(["xdotool", "getactivewindow"])
        active_int = int(active)
        for w in wins:
            if int(w["id"], 16) == active_int:
                w["focused"] = True
    except Exception:
        pass
    return {"windows": wins}, 200


def apps(_params: dict) -> tuple[dict, int]:
    result = []
    seen = set()
    try:
        out = _run(["wmctrl", "-l", "-p"])
        for line in out.splitlines():
            parts = line.split(None, 4)
            if len(parts) >= 5:
                pid = int(parts[2]) if parts[2] != "0" else 0
                name = parts[4]
                if pid:
                    try:
                        name = _run(["ps", "-p", str(pid), "-o", "comm="])
                    except Exception:
                        pass
                if name not in seen:
                    seen.add(name)
                    result.append({"name": name, "pid": pid})
    except Exception:
        pass
    return {"apps": result}, 200


def focus(params: dict) -> tuple[dict, int]:
    app = params.get("app")
    window_id = params.get("window_id")
    if window_id:
        _run(["wmctrl", "-i", "-a", str(window_id)])
        return {"focused": window_id}, 200
    if not app:
        return {"error": "app or window_id required"}, 400
    try:
        out = _run(["wmctrl", "-l"])
        app_lower = app.lower()
        for line in out.splitlines():
            if app_lower in line.lower():
                wid = line.split()[0]
                _run(["wmctrl", "-i", "-a", wid])
                return {"focused": app}, 200
    except Exception:
        pass
    return {"error": "not found"}, 404


def launch(params: dict) -> tuple[dict, int]:
    app = params.get("app")
    if not app:
        return {"error": "app required"}, 400
    # Try original name, lowercase, and hyphenated-lowercase
    candidates = [app, app.lower(), app.lower().replace(" ", "-")]
    for name in dict.fromkeys(candidates):  # dedup preserving order
        try:
            subprocess.Popen([name], stdout=subprocess.DEVNULL,
                             stderr=subprocess.DEVNULL, start_new_session=True)
            return {"launched": name}, 200
        except FileNotFoundError:
            continue
    return {"error": f"could not find executable for '{app}'"}, 404
