-- AXPress handler: find element by title/role and perform an action
-- Tries AXPress, AXPick, AXConfirm, AXOpen in order
-- Fallback for zero-frame elements (e.g., System Settings sidebar items)
local json = hs.json

local MAX_NODES = 2000
local TRY_ACTIONS = {"AXPress", "AXPick", "AXConfirm", "AXOpen"}

local function safeAttr(elem, attr, default)
    local ok, val = pcall(function() return elem:attributeValue(attr) end)
    return ok and val or default
end

local function searchAndPress(elem, depth, maxDepth, target, state)
    if not elem or depth > maxDepth or state.found then return end
    if state.count >= MAX_NODES then return end
    state.count = state.count + 1

    local role = safeAttr(elem, "AXRole", "") or ""
    local title = safeAttr(elem, "AXTitle", "") or ""
    local desc = safeAttr(elem, "AXDescription", "") or ""

    local matchRole = not target.role or role == target.role
    local matchTitle = not target.title
    if target.title then
        local tl = target.title:lower()
        matchTitle = title:lower():find(tl, 1, true)
            or desc:lower():find(tl, 1, true)
    end

    if matchRole and matchTitle and (target.role or target.title) then
        state.matchIndex = state.matchIndex + 1
        if state.matchIndex == target.index then
            local actions = safeAttr(elem, "AXActionNames", {}) or {}
            for _, tryAction in ipairs(TRY_ACTIONS) do
                for _, a in ipairs(actions) do
                    if a == tryAction then
                        local ok, err = pcall(function()
                            elem:performAction(tryAction)
                        end)
                        state.found = true
                        state.result = {
                            pressed = ok, action = tryAction,
                            title = title ~= "" and title or desc, role = role,
                            error = not ok and tostring(err) or nil,
                        }
                        return
                    end
                end
            end
            state.found = true
            state.result = {
                pressed = false, title = title ~= "" and title or desc,
                role = role, error = "no supported action", actions = actions,
            }
            return
        end
    end

    local children = safeAttr(elem, "AXChildren", {}) or {}
    for _, child in ipairs(children) do
        if state.found or state.count >= MAX_NODES then break end
        searchAndPress(child, depth + 1, maxDepth, target, state)
    end
end

return function(params)
    local app
    if params.app then
        app = hs.application.find(params.app)
    else
        app = hs.application.frontmostApplication()
    end
    if not app then return json.encode({error = "no app found"}), 404 end

    local elem = hs.axuielement.applicationElement(app)
    if not elem then return json.encode({error = "cannot access app"}), 500 end

    local target = {
        title = params.title, role = params.role,
        index = (params.index or 0),
    }
    local state = {count = 0, matchIndex = -1, found = false, result = nil}
    searchAndPress(elem, 0, 8, target, state)

    if not state.found then
        return json.encode({error = "element not found", searched = state.count}), 404
    end
    return json.encode(state.result), 200
end
