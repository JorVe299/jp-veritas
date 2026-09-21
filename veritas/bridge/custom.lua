-- veritas/bridge/custom.lua
-- Your own integration. This file ships empty on purpose and is the one
-- place you can edit without getting conflicts on the next update.
--
-- Two things you can do here:
--
--   1. Teach the bridge a framework it does not know yet (further down).
--   2. Add routes of your own, for anything the panel should be able to ask
--      your server that is not covered by the built-in ones.
--
-- ---------------------------------------------------------------------------
-- 1. Routes of your own
-- ---------------------------------------------------------------------------
--
-- Veritas.route(method, path, handler) registers an endpoint under the same
-- URL as the rest: http://<server>:30120/veritas/<path>
--
-- The handler gets (body, res). `body` is the decoded JSON of a POST, or an
-- empty table for a GET. Answer with Veritas.ok(res, table) or
-- Veritas.fail(res, 'message').
--
-- Anything registered here is reachable from the backend right away - no
-- change to the panel needed if you only want to read something out.
--
-- Example: how many people are in a given job right now.
--
-- Veritas.route('POST', '/job-headcount', function(body, res)
--     local adapter = Bridge.require()
--     if not adapter then return Veritas.fail(res, 'No framework active') end
--
--     local count = 0
--     for id in pairs(adapter.getOnline()) do
--         local player = adapter.getPlayer(id)
--         if player and player.PlayerData
--             and player.PlayerData.job.name == body.job then
--             count = count + 1
--         end
--     end
--     Veritas.ok(res, { job = body.job, online = count })
-- end)
--
-- Example: read something out of another resource's state bag.
--
-- Veritas.route('GET', '/weather', function(_, res)
--     Veritas.ok(res, { weather = GlobalState.weather })
-- end)
--
-- ---------------------------------------------------------------------------
-- 2. A framework of your own
-- ---------------------------------------------------------------------------
--
-- Fill in the functions below and set Config.Framework = 'custom'.
-- bridge/adapter.lua documents what each one has to return. Anything your
-- framework cannot do should return false rather than pretending - the panel
-- then reports it honestly instead of showing a success that never happened.

local adapter = {
    id = 'custom',
    label = 'Custom framework',

    -- 'citizenid' or 'identifier' - whichever column your database keys
    -- characters on. The backend needs this to build its queries.
    identityKey = 'citizenid',
}

function adapter.detect()
    -- Return true when your framework is present. Left false so that
    -- automatic detection never picks this adapter by accident.
    return false
end

function adapter.init()
    -- Fetch your core object here. Return false if it is not reachable.
    return false
end

function adapter.getPlayer(_) return nil end
function adapter.getSource(player) return player.source end
function adapter.getOnline() return {} end

function adapter.addMoney(_, _, _, _) return false end
function adapter.removeMoney(_, _, _, _) return false end
function adapter.setJob(_, _, _) return false end
function adapter.setMetadata(_, _, _) return false end
function adapter.revive(_, _) return false end
function adapter.heal(_, _, _) return false end
function adapter.notify(_, _, _) return false end

function adapter.dumpShared()
    -- Whatever you return here is written to the resource folder as JSON and
    -- read by the backend for the pickers in the panel.
    return {}
end

Bridge.register(adapter)
