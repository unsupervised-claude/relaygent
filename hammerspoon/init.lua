-- Hammerspoon config for Relaygent computer-use
-- HTTP API on configurable port for screen capture, accessibility tree, and input

local f = io.open("/tmp/hs_init_ran", "w"); if f then f:write(os.date()); f:close() end

hs.allowAppleScript(true)
hs.autoLaunch(true)
hs.consoleOnTop(false)
hs.openConsoleOnDockClick(false)
pcall(function() hs.console.hswindow():close() end)
local json = hs.json
local PORT = tonumber(os.getenv("HAMMERSPOON_PORT")) or 8097
local input = dofile(hs.configdir .. "/input_handlers.lua")

local function annotateWithIndicator(img, ix, iy)
    local sz = img:size()
    local r = 18
    local c = hs.canvas.new(hs.geometry.rect(0, 0, sz.w, sz.h))
    c:appendElements(
        {type="image", image=img, frame={x=0,y=0,w=sz.w,h=sz.h}},
        {type="oval", frame={x=ix-r, y=iy-r, w=r*2, h=r*2},
         strokeColor={red=1,green=0,blue=0,alpha=0.9}, strokeWidth=3, action="stroke"},
        {type="oval", frame={x=ix-3, y=iy-3, w=6, h=6},
         fillColor={red=1,green=0,blue=0,alpha=0.9}, action="fill"}
    )
    local result = c:imageFromCanvas()
    c:delete()
    return result
end

local function handleRequest(method, path, headers, body)
    local params = {}
    if body and #body > 0 then
        local ok, p = pcall(json.decode, body)
        if ok then params = p end
    end
    local key = method .. " " .. path
    local ok, rb, code = pcall(function()
        if key == "GET /health" then
            return json.encode({status="ok", screens=#hs.screen.allScreens()}), 200
        elseif key == "POST /reload" then
            hs.timer.doAfter(0.1, hs.reload)
            return json.encode({status="reloading"}), 200
        elseif key == "POST /screenshot" then
            local p = params.path or "/tmp/claude-screenshot.png"
            local scr = hs.screen.mainScreen()
            if not scr then return json.encode({error="no screen"}), 500 end
            local ix, iy = params.indicator_x, params.indicator_y
            if params.x and params.y and params.w and params.h then
                local img = scr:snapshot(hs.geometry.rect(params.x, params.y, params.w, params.h))
                if img and ix and iy then img = annotateWithIndicator(img, ix - params.x, iy - params.y) end
                if img then img:saveToFile(p) end
                return json.encode({path=p, width=params.w, height=params.h,
                    crop={x=params.x,y=params.y,w=params.w,h=params.h}}), 200
            end
            local img = scr:snapshot()
            if img and ix and iy then img = annotateWithIndicator(img, ix, iy) end
            if img then img:saveToFile(p) end
            local sf = scr:fullFrame()
            return json.encode({path=p, width=sf.w, height=sf.h}), 200
        elseif key == "POST /click" then
            return input.click(params)
        elseif key == "POST /type" then
            return input.type_input(params)
        elseif key == "POST /drag" then
            return input.drag(params)
        elseif key == "POST /scroll" then
            return input.scroll(params)
        elseif key == "GET /windows" then
            local wins = {}
            for _, w in ipairs(hs.window.allWindows()) do
                local wf = w:frame(); local a = w:application()
                table.insert(wins, {id=w:id(), title=w:title(), app=a and a:name() or "?",
                    frame={x=wf.x,y=wf.y,w=wf.w,h=wf.h}, focused=(w==hs.window.focusedWindow())})
            end
            return json.encode({windows=wins}), 200
        elseif key == "GET /apps" then
            local apps = {}
            for _, a in ipairs(hs.application.runningApplications()) do
                if a:mainWindow() then
                    table.insert(apps, {name=a:name(), bundleID=a:bundleID(), pid=a:pid()})
                end
            end
            return json.encode({apps=apps}), 200
        elseif key == "POST /focus" then
            if not params.app then return json.encode({error="app required"}), 400 end
            local a = hs.application.find(params.app)
            if a then a:activate(); return json.encode({focused=params.app}), 200 end
            return json.encode({error="not found"}), 404
        elseif key == "POST /launch" then
            if not params.app then return json.encode({error="app required"}), 400 end
            hs.application.launchOrFocus(params.app)
            hs.timer.doAfter(0.3, function()
                local a = hs.application.find(params.app)
                if a then a:activate() end
            end)
            return json.encode({launched=params.app}), 200
        elseif key == "POST /type_from_file" then
            return input.type_from_file(params)
        elseif key == "POST /element_at" then
            if not params.x or not params.y then return json.encode({error="x,y needed"}), 400 end
            local el = hs.axuielement.systemElementAtPosition(hs.geometry.point(params.x, params.y))
            if not el then return json.encode({error="no element"}), 404 end
            local fr = el:attributeValue("AXFrame")
            return json.encode({role=el:attributeValue("AXRole") or "",
                title=el:attributeValue("AXTitle") or "",
                value=tostring(el:attributeValue("AXValue") or ""),
                frame=fr and {x=math.floor(fr.x),y=math.floor(fr.y),
                    w=math.floor(fr.w),h=math.floor(fr.h)} or nil}), 200
        elseif key == "POST /accessibility" then
            return dofile(hs.configdir .. "/ax_handler.lua")(params)
        elseif key == "POST /ax_press" then
            return dofile(hs.configdir .. "/ax_press.lua")(params)
        elseif key == "POST /dismiss_dialog" then
            local target = params.button or "Don't Allow"
            local dialogs = {"UserNotificationCenter","SecurityAgent","System Preferences","System Settings"}
            for _, appName in ipairs(dialogs) do
                local app = hs.application.find(appName)
                if app then
                    local elem = hs.axuielement.applicationElement(app)
                    local function findBtn(el, depth)
                        if not el or depth > 6 then return false end
                        for _, c in ipairs(el:attributeValue("AXChildren") or {}) do
                            local role = c:attributeValue("AXRole") or ""
                            local title = c:attributeValue("AXTitle") or ""
                            if role == "AXButton" and title == target then
                                c:performAction("AXPress"); return true
                            end
                            if findBtn(c, depth+1) then return true end
                        end
                        return false
                    end
                    for _, w in ipairs(elem:attributeValue("AXChildren") or {}) do
                        if w:attributeValue("AXRole") == "AXWindow" and findBtn(w, 0) then
                            return json.encode({dismissed=true, app=appName, button=target}), 200
                        end
                    end
                end
            end
            return json.encode({dismissed=false, error="no dialog found"}), 404
        end
        return json.encode({error="not found", path=path}), 404
    end)
    if ok then
        return rb, code, {["Content-Type"]="application/json"}
    else
        return json.encode({error=tostring(rb)}), 500, {["Content-Type"]="application/json"}
    end
end

_G.__claude_server = hs.httpserver.new(false, false)
_G.__claude_server:setPort(PORT)
_G.__claude_server:setInterface("localhost")
_G.__claude_server:setCallback(handleRequest)
_G.__claude_server:maxBodySize(1048576)
_G.__claude_server:start()
hs.printf("Relaygent computer-use API on localhost:%d", PORT)
