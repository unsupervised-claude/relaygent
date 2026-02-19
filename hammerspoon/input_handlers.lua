-- Input event handlers for click, type, scroll, type_from_file
-- Extracted from init.lua to stay under 200 lines

local json = hs.json
local M = {}

-- Shift-symbol to base key mapping for chars not in hs.keycodes.map
local shiftChars = {
    ["!"]="1",["@"]="2",["#"]="3",["$"]="4",["%"]="5",
    ["^"]="6",["&"]="7",["*"]="8",["("]="9",[")"]="0",
    ["_"]="-",["+"]="=",["{"]="[",["}"]="]",["|"]="\\",
    [":"]=";",['"']="'",["<"]=",",[">"]=".",["?"]="/",["~"]="`",
}

local specialChars = {[" "]="space", ["\n"]="return", ["\t"]="tab"}

-- Type text using per-character keycodes (works in VMs unlike keyStrokes)
local function typeWithKeycodes(text, targetApp)
    local map = hs.keycodes.map
    for i = 1, #text do
        local c = text:sub(i, i)
        local kc, mods = nil, {}
        if specialChars[c] then
            kc = map[specialChars[c]]
        else
            local lower = c:lower()
            kc = map[lower]
            if kc then
                if c ~= lower then mods = {"shift"} end
            else
                local base = shiftChars[c]
                if base then
                    kc = map[base]
                    mods = {"shift"}
                end
            end
        end
        if kc then
            if #mods > 0 then
                for _, m in ipairs(mods) do
                    hs.eventtap.event.newKeyEvent(m, true):post()
                end
                hs.eventtap.event.newKeyEvent(mods, kc, true):post()
                hs.eventtap.event.newKeyEvent(mods, kc, false):post()
                for _, m in ipairs(mods) do
                    hs.eventtap.event.newKeyEvent(m, false):post()
                end
            else
                hs.eventtap.event.newKeyEvent({}, kc, true):post()
                hs.eventtap.event.newKeyEvent({}, kc, false):post()
            end
        end
    end
end

function M.click(params)
    if not params.x or not params.y then return json.encode({error="x,y required"}), 400 end
    local pt = hs.geometry.point(params.x, params.y)
    local types = hs.eventtap.event.types
    local flags = {}
    if params.modifiers then
        for _, m in ipairs(params.modifiers) do flags[m] = true end
    end
    local function postWithFlags(ev, target)
        if next(flags) then ev:setFlags(flags) end
        if target then ev:post(target) else ev:post() end
    end
    if params.right then
        postWithFlags(hs.eventtap.event.newMouseEvent(types.rightMouseDown, pt))
        hs.timer.doAfter(0.02, function()
            postWithFlags(hs.eventtap.event.newMouseEvent(types.rightMouseUp, pt))
        end)
    elseif params.double then
        postWithFlags(hs.eventtap.event.newMouseEvent(types.leftMouseDown, pt))
        hs.timer.doAfter(0.02, function()
            postWithFlags(hs.eventtap.event.newMouseEvent(types.leftMouseUp, pt))
            hs.timer.doAfter(0.02, function()
                local ev2 = hs.eventtap.event.newMouseEvent(types.leftMouseDown, pt)
                ev2:setProperty(hs.eventtap.event.properties.mouseEventClickState, 2)
                postWithFlags(ev2)
                hs.timer.doAfter(0.02, function()
                    postWithFlags(hs.eventtap.event.newMouseEvent(types.leftMouseUp, pt))
                end)
            end)
        end)
    else
        local targetApp = nil
        if params.pid then targetApp = hs.application.applicationForPID(params.pid) end
        postWithFlags(hs.eventtap.event.newMouseEvent(types.leftMouseDown, pt), targetApp)
        hs.timer.doAfter(0.02, function()
            postWithFlags(hs.eventtap.event.newMouseEvent(types.leftMouseUp, pt), targetApp)
        end)
        -- AX fallback for native dialogs (TCC/security windows block CGEvent)
        pcall(function()
            local el = hs.axuielement.systemElementAtPosition(pt)
            if el and el:attributeValue("AXRole") == "AXButton" then
                el:performAction("AXPress")
            end
        end)
    end
    return json.encode({clicked={x=params.x, y=params.y, modifiers=params.modifiers}}), 200
end

function M.type_input(params)
    local targetApp = nil
    if params.pid then targetApp = hs.application.applicationForPID(params.pid) end
    if params.text then
        typeWithKeycodes(params.text, targetApp)
        return json.encode({typed=#params.text, pid=params.pid}), 200
    elseif params.key then
        local mods = params.modifiers or {}
        local k = params.keycode or params.key
        if #mods > 0 then
            for _, m in ipairs(mods) do hs.eventtap.event.newKeyEvent(m, true):post() end
        end
        local down = hs.eventtap.event.newKeyEvent(mods, k, true)
        local up = hs.eventtap.event.newKeyEvent(mods, k, false)
        if targetApp then down:post(targetApp); up:post(targetApp)
        else down:post(); up:post() end
        if #mods > 0 then
            for _, m in ipairs(mods) do hs.eventtap.event.newKeyEvent(m, false):post() end
        end
        return json.encode({key=params.key, pid=params.pid}), 200
    end
    return json.encode({error="text or key required"}), 400
end

function M.scroll(params)
    local dy = -(params.amount or 3)
    local reps = params["repeat"] or 1
    if params.x and params.y then
        hs.mouse.absolutePosition(hs.geometry.point(params.x, params.y))
    end
    hs.eventtap.scrollWheel({0, dy}, {})
    for i = 2, reps do
        hs.timer.doAfter(0.05 * (i - 1), function()
            hs.eventtap.scrollWheel({0, dy}, {})
        end)
    end
    return json.encode({scrolled=dy, ["repeat"]=reps}), 200
end

function M.drag(params)
    if not params.startX or not params.startY or not params.endX or not params.endY then
        return json.encode({error="startX, startY, endX, endY required"}), 400
    end
    local types = hs.eventtap.event.types
    local sx, sy = params.startX, params.startY
    local ex, ey = params.endX, params.endY
    local steps = params.steps or 10
    local duration = params.duration or 0.3
    local stepDelay = duration / steps
    hs.eventtap.event.newMouseEvent(types.leftMouseDown, hs.geometry.point(sx, sy)):post()
    for i = 1, steps do
        local t = i / steps
        local cx = sx + (ex - sx) * t
        local cy = sy + (ey - sy) * t
        hs.timer.doAfter(stepDelay * i, function()
            hs.eventtap.event.newMouseEvent(types.leftMouseDragged, hs.geometry.point(cx, cy)):post()
            if i == steps then
                hs.timer.doAfter(0.02, function()
                    hs.eventtap.event.newMouseEvent(types.leftMouseUp, hs.geometry.point(ex, ey)):post()
                end)
            end
        end)
    end
    return json.encode({dragged={from={x=sx,y=sy}, to={x=ex,y=ey}, steps=steps}}), 200
end

function M.type_from_file(params)
    if not params.path then return json.encode({error="path required"}), 400 end
    local f = io.open(params.path, "r")
    if not f then return json.encode({error="file not found"}), 404 end
    local text = f:read("*a"):gsub("%s+$", "")
    f:close()
    typeWithKeycodes(text, nil)
    return json.encode({typed=#text, source=params.path}), 200
end

return M
