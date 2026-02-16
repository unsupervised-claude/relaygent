-- Accessibility tree handler, loaded lazily by init.lua
-- Returns a function(params) -> json_string, status_code
local json = hs.json

local MAX_NODES = 2000

local function safeAttr(elem, attr, default)
    local ok, val = pcall(function() return elem:attributeValue(attr) end)
    return ok and val or default
end

local function buildTree(elem, depth, maxDepth, state)
    if not elem or depth > maxDepth then return nil end
    if state.count >= MAX_NODES then return nil end
    state.count = state.count + 1
    local role = safeAttr(elem, "AXRole", "") or ""
    local title = safeAttr(elem, "AXTitle", "") or ""
    local value = safeAttr(elem, "AXValue", nil)
    local desc = safeAttr(elem, "AXDescription", "") or ""
    local frame = safeAttr(elem, "AXFrame", nil)
    local node = {role = role}
    if title ~= "" then node.title = title end
    if value ~= nil and value ~= "" then node.value = tostring(value) end
    if desc ~= "" then node.description = desc end
    if frame then
        node.frame = {
            x = math.floor(frame.x), y = math.floor(frame.y),
            w = math.floor(frame.w), h = math.floor(frame.h),
        }
    end
    local dominated = (role == "AXGroup" or role == "AXLayoutArea"
        or role == "AXScrollArea" or role == "AXSplitGroup")
    local dominated_and_empty = dominated and title == "" and desc == ""
    local children = safeAttr(elem, "AXChildren", {}) or {}
    if #children > 0 and depth < maxDepth and state.count < MAX_NODES then
        local childNodes = {}
        for _, child in ipairs(children) do
            if state.count >= MAX_NODES then break end
            local childNode = buildTree(child, depth + 1, maxDepth, state)
            if childNode then table.insert(childNodes, childNode) end
        end
        if #childNodes > 0 then node.children = childNodes end
    end
    if dominated_and_empty and not node.children then return nil end
    return node
end

return function(params)
    local maxDepth = params.depth or 4
    local app
    if params.app then
        app = hs.application.find(params.app)
    else
        app = hs.application.frontmostApplication()
    end
    if not app then return json.encode({error = "no app found"}), 404 end
    local elem = hs.axuielement.applicationElement(app)
    if not elem then return json.encode({error = "cannot access app"}), 500 end
    local state = {count = 0}
    local tree = buildTree(elem, 0, maxDepth, state)
    local truncated = state.count >= MAX_NODES
    return json.encode({
        app = app:name(), tree = tree,
        nodes = state.count, truncated = truncated,
    }), 200
end
