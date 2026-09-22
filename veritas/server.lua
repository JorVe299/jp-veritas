-- veritas/server.lua
-- The HTTP bridge. Hangs off FiveM's own HTTP server (default 30120) and is
-- reachable at http://<server>:30120/veritas/<route>
--
-- This file only routes and guards. What actually happens per framework
-- lives in bridge/, and anything you add yourself belongs in
-- bridge/custom.lua.

Veritas = { routes = {} }

local function sendJson(res, payload, status)
    res.writeHead(status or 200, { ['Content-Type'] = 'application/json' })
    res.send(json.encode(payload))
end

function Veritas.ok(res, payload)
    local body = payload or {}
    body.success = true
    sendJson(res, body)
end

function Veritas.fail(res, message, status)
    sendJson(res, { success = false, msg = message }, status)
end

-- Registers a route. Used by everything below and by bridge/custom.lua.
function Veritas.route(method, path, handler, opts)
    Veritas.routes[method .. ' ' .. path] = {
        handler = handler,
        needsToken = opts and opts.needsToken or false,
    }
end

-- --- Token ------------------------------------------------------------------
-- The bridge sits on the public game port. Comparing in constant time costs
-- nothing here and keeps the check from leaking the token one byte at a time.

local function constantEquals(a, b)
    if type(a) ~= 'string' or type(b) ~= 'string' then return false end
    if #a ~= #b then return false end
    local diff = 0
    for i = 1, #a do
        diff = diff | (string.byte(a, i) ~ string.byte(b, i))
    end
    return diff == 0
end

local function tokenOk(req)
    local expected = Config.Token or ''
    if expected == '' then return false end
    local given = req.headers['X-Veritas-Token'] or req.headers['x-veritas-token']
    return constantEquals(given, expected)
end

-- --- Framework routes -------------------------------------------------------
-- Every one of them needs a player, so that lookup happens once here.

local function withPlayer(body, res, fn)
    local adapter, err = Bridge.require()
    if not adapter then return Veritas.fail(res, err) end

    local player = adapter.getPlayer(body.citizenid)
    if not player then return Veritas.fail(res, 'Player offline') end

    return fn(adapter, player, adapter.getSource(player))
end

Veritas.route('POST', '/check-online', function(body, res)
    local adapter, err = Bridge.require()
    if not adapter then return Veritas.fail(res, err) end

    local player = adapter.getPlayer(body.citizenid)
    sendJson(res, {
        isOnline = player ~= nil,
        source = player and adapter.getSource(player) or nil,
    })
end)

Veritas.route('GET', '/get-online-players', function(_, res)
    local adapter = Bridge.require()
    if not adapter then return sendJson(res, {}) end
    sendJson(res, adapter.getOnline())
end)

Veritas.route('POST', '/update-money', function(body, res)
    withPlayer(body, res, function(adapter, player)
        local account = body.type or 'bank'
        local amount = tonumber(body.amount) or 0

        -- Adding and subtracting are separate calls in every framework,
        -- because none of them accept a negative amount.
        local ok
        if amount >= 0 then
            ok = adapter.addMoney(player, account, amount, 'veritas-panel')
        else
            ok = adapter.removeMoney(player, account, math.abs(amount), 'veritas-panel')
        end

        if ok then Veritas.ok(res, { msg = 'Live updated' })
        else Veritas.fail(res, 'Transaction rejected (insufficient funds?)') end
    end)
end)

Veritas.route('POST', '/update-job', function(body, res)
    withPlayer(body, res, function(adapter, player)
        if adapter.setJob(player, body.jobName, tonumber(body.gradeLevel) or 0) then
            Veritas.ok(res, { msg = 'Live updated' })
        else
            Veritas.fail(res, 'This framework cannot set a job through the bridge')
        end
    end)
end)

Veritas.route('POST', '/update-metadata', function(body, res)
    withPlayer(body, res, function(adapter, player)
        -- Two call shapes: a single key with a value (licences), or several
        -- fields at once (condition values).
        local done = false
        if body.key ~= nil then
            done = adapter.setMetadata(player, body.key, body.value)
        elseif type(body.fields) == 'table' then
            done = true
            for field, value in pairs(body.fields) do
                if not adapter.setMetadata(player, field, value) then done = false end
            end
        else
            return Veritas.fail(res, 'Neither key nor fields given')
        end

        if done then Veritas.ok(res, { msg = 'Live updated' })
        else Veritas.fail(res, 'This framework has no metadata support') end
    end)
end)

Veritas.route('POST', '/update-inventory', function(body, res)
    withPlayer(body, res, function(_, player, src)
        local item = body.item
        local count = tonumber(body.amount) or 0
        local ok

        if body.action == 'add' then
            ok = Items.add(player, src, item, count, body.slot)
        elseif body.action == 'remove' then
            ok = Items.remove(player, src, item, count, body.slot)
        elseif body.action == 'set' then
            ok = Items.set(player, src, item, count, body.slot)
        else
            return Veritas.fail(res, 'Unknown action: ' .. tostring(body.action))
        end

        if ok then Veritas.ok(res, { msg = 'Live updated', inventory = Items.detect() })
        else Veritas.fail(res, 'The inventory rejected the action (full, or item not present?)') end
    end)
end)

Veritas.route('POST', '/kick-player', function(body, res)
    withPlayer(body, res, function(_, _, src)
        DropPlayer(src, body.reason or 'Removed by an administrator')
        Veritas.ok(res, { msg = 'Player kicked' })
    end)
end)

Veritas.route('POST', '/revive-player', function(body, res)
    withPlayer(body, res, function(adapter, player, src)
        if adapter.revive(player, src) then Veritas.ok(res, { msg = 'Player revived' })
        else Veritas.fail(res, 'This framework cannot revive through the bridge') end
    end)
end)

Veritas.route('POST', '/heal-player', function(body, res)
    withPlayer(body, res, function(adapter, player, src)
        if adapter.heal(player, src, body.armor ~= false) then Veritas.ok(res, { msg = 'Player healed' })
        else Veritas.fail(res, 'This framework cannot heal through the bridge') end
    end)
end)

Veritas.route('POST', '/teleport-player', function(body, res)
    withPlayer(body, res, function(_, _, src)
        SetEntityCoords(GetPlayerPed(src), body.x + 0.0, body.y + 0.0, body.z + 0.0, false, false, false, false)
        Veritas.ok(res, { msg = 'Player moved' })
    end)
end)

Veritas.route('POST', '/notify-player', function(body, res)
    withPlayer(body, res, function(adapter, _, src)
        if adapter.notify(src, body.message, body.type) then Veritas.ok(res, { msg = 'Message sent' })
        else Veritas.fail(res, 'This framework has no notification the bridge can use') end
    end)
end)

-- --- What is this server? ---------------------------------------------------
-- The backend reads this at startup so the panel can state which framework
-- and which inventory it is looking at, instead of assuming.

Veritas.route('GET', '/status', function(_, res)
    local adapter = Bridge.active
    local detected = {}
    for id, a in pairs(Bridge.adapters) do detected[id] = a.detect() end

    sendJson(res, {
        resource = GetCurrentResourceName(),
        framework = adapter and adapter.id or nil,
        frameworkLabel = adapter and adapter.label or nil,
        identityKey = adapter and adapter.identityKey or nil,
        inventory = Items.detect(),
        tokenConfigured = (Config.Token or '') ~= '',
        tokenRequiredEverywhere = Config.RequireTokenEverywhere == true,
        adapters = detected,
    })
end)

-- --- Dispatch ---------------------------------------------------------------

SetHttpHandler(function(req, res)
    local route = Veritas.routes[req.method .. ' ' .. req.path]

    if not route then
        return sendJson(res, { success = false, msg = 'Route not found' }, 404)
    end

    if (route.needsToken or Config.RequireTokenEverywhere) and not tokenOk(req) then
        local why = (Config.Token or '') == ''
            and 'This route needs Config.Token to be set in the bridge resource'
            or 'Missing or wrong X-Veritas-Token header'
        return sendJson(res, { success = false, msg = why }, 401)
    end

    if req.method == 'GET' then
        return route.handler({}, res)
    end

    req.setDataHandler(function(raw)
        local ok, body = pcall(json.decode, raw)
        route.handler(ok and body or {}, res)
    end)
end)

-- --- Startup ----------------------------------------------------------------

AddEventHandler('onResourceStart', function(resource)
    if GetCurrentResourceName() ~= resource then return end

    local adapter = Bridge.select()
    if not adapter then return end

    print(('^2[Veritas] ^7Inventory: %s'):format(Items.detect()))
    if (Config.Token or '') == '' then
        print('^3[Veritas] ^7Config.Token is empty - /export stays closed and the other routes are unauthenticated.')
    end

    -- Write the shared tables out as JSON so the backend can read them.
    local dumps = adapter.dumpShared()
    for name, fn in pairs(Config.ExtraDumps or {}) do
        local ok, extra = pcall(fn)
        if ok then dumps[name] = extra end
    end

    for filename, data in pairs(dumps) do
        SaveResourceFile(GetCurrentResourceName(), filename, json.encode(data, { indent = true }), -1)
        print(('^2[Veritas] ^7Exported %s'):format(filename))
    end

    -- Let the backend know (fire and forget)
    PerformHttpRequest('http://localhost:3001/api/system/refresh', function(err)
        if err == 200 then
            print('^2[Veritas] ^7Backend synced successfully.')
        else
            print('^1[Veritas] ^7Could not sync with the backend (is it running?)')
        end
    end, 'POST', '', { ['Content-Type'] = 'application/json' })
end)
