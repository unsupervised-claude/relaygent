"""Accessibility handlers for Linux computer-use via AT-SPI2 (pyatspi2).

Works on both X11 and Wayland — AT-SPI2 uses D-Bus, not the display server.
Install: apt install at-spi2-core python3-pyatspi gir1.2-atspi-2.0
"""
from __future__ import annotations

MAX_NODES = 2000
SKIP_ROLES = {"panel", "filler", "scroll pane", "split pane", "section"}
TRY_ACTIONS = ["click", "press", "activate", "open"]

try:
    import pyatspi
    HAS_ATSPI = True
except ImportError:
    HAS_ATSPI = False


def _get_app(name):
    if not HAS_ATSPI:
        return None, "pyatspi2 not installed"
    desktop = pyatspi.Registry.getDesktop(0)
    if name:
        nl = name.lower()
        for app in desktop:
            if app and app.name and nl in app.name.lower():
                return app, None
        return None, f"app '{name}' not found"
    for app in desktop:
        try:
            for child in app:
                if child.getState().contains(pyatspi.STATE_ACTIVE):
                    return app, None
        except Exception:
            continue
    for app in desktop:
        try:
            if app.childCount > 0:
                return app, None
        except Exception:
            continue
    return None, "no app found"


def _frame(obj):
    try:
        ext = obj.queryComponent().getExtents(pyatspi.DESKTOP_COORDS)
        if ext.width > 0 or ext.height > 0:
            return {"x": ext.x, "y": ext.y, "w": ext.width, "h": ext.height}
    except Exception:
        pass
    return None


def _role(obj):
    try:
        return obj.getRoleName()
    except Exception:
        return ""


def _axrole(role):
    return ("AX" + role.replace(" ", "")) if role else ""


def _attr(obj, attr, default=""):
    try:
        return getattr(obj, attr, default) or default
    except Exception:
        return default


def _build_tree(obj, depth, max_depth, state):
    if obj is None or depth > max_depth or state["count"] >= MAX_NODES:
        return None
    state["count"] += 1
    role = _role(obj)
    name = _attr(obj, "name", "")
    desc = _attr(obj, "description", "")
    node = {"role": _axrole(role)}
    if name:
        node["title"] = name
    if desc:
        node["description"] = desc
    frame = _frame(obj)
    if frame:
        node["frame"] = frame
    try:
        node["value"] = str(obj.queryValue().currentValue)
    except Exception:
        pass
    children = []
    if depth < max_depth and state["count"] < MAX_NODES:
        try:
            for i in range(obj.childCount):
                if state["count"] >= MAX_NODES:
                    break
                cn = _build_tree(obj.getChildAtIndex(i), depth + 1, max_depth, state)
                if cn:
                    children.append(cn)
        except Exception:
            pass
    if children:
        node["children"] = children
    elif role.lower() in SKIP_ROLES and not name and not desc:
        return None
    return node


def accessibility_tree(params):
    app, err = _get_app(params.get("app"))
    if err:
        return {"error": err}, 404
    state = {"count": 0}
    tree = _build_tree(app, 0, params.get("depth", 4), state)
    return {"app": app.name or "unknown", "tree": tree,
            "nodes": state["count"],
            "truncated": state["count"] >= MAX_NODES}, 200


def element_at(params):
    x, y = params.get("x"), params.get("y")
    if x is None or y is None:
        return {"error": "x,y needed"}, 400
    if not HAS_ATSPI:
        return {"error": "pyatspi2 not installed"}, 500
    desktop = pyatspi.Registry.getDesktop(0)
    for app in desktop:
        try:
            for win in app:
                obj = win.queryComponent().getAccessibleAtPoint(
                    int(x), int(y), pyatspi.DESKTOP_COORDS)
                if obj:
                    return {"role": _axrole(_role(obj)),
                            "title": _attr(obj, "name", ""),
                            "value": "", "frame": _frame(obj)}, 200
        except Exception:
            continue
    return {"error": "no element"}, 404


def _search_press(obj, depth, target, state):
    if obj is None or depth > 8 or state["count"] >= MAX_NODES:
        return None
    state["count"] += 1
    role = _role(obj)
    name, desc = _attr(obj, "name", ""), _attr(obj, "description", "")
    rs = _axrole(role)
    match_r = not target["role"] or rs == target["role"]
    match_t = not target["title"] or (
        target["title"] in name.lower() or target["title"] in desc.lower())
    if match_r and match_t and (target["role"] or target["title"]):
        state["mi"] += 1
        if state["mi"] == target["index"]:
            title = name or desc
            try:
                ai = obj.queryAction()
                for ta in TRY_ACTIONS:
                    for i in range(ai.nActions):
                        if ai.getName(i) == ta:
                            ai.doAction(i)
                            return {"pressed": True, "action": ta,
                                    "title": title, "role": rs}
                return {"pressed": False, "title": title, "role": rs,
                        "error": "no supported action"}
            except Exception:
                return {"pressed": False, "title": title, "role": rs,
                        "error": "no action interface"}
    try:
        for i in range(obj.childCount):
            r = _search_press(obj.getChildAtIndex(i), depth + 1, target, state)
            if r:
                return r
    except Exception:
        pass
    return None


def ax_press(params):
    app, err = _get_app(params.get("app"))
    if err:
        return {"error": err}, 404
    target = {"title": (params.get("title") or "").lower(),
              "role": params.get("role", ""),
              "index": params.get("index", 0)}
    state = {"count": 0, "mi": -1}
    result = _search_press(app, 0, target, state)
    if result:
        return result, 200
    return {"error": "element not found", "searched": state["count"]}, 404
