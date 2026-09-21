-- veritas/bridge/qbox.lua
-- Qbox is a QBCore fork. It ships a qb-core compatibility layer, so the
-- shared implementation applies - but it is reached through qbx_core, and it
-- is checked first so a Qbox server is not mistaken for plain QBCore.

local adapter = QBFamily.build('qbox', 'Qbox (qbx_core)', 'qbx_core', 'GetCoreObject')

-- Qbox keeps the compatibility export on qb-core while the real core lives
-- in qbx_core. If qbx_core is running we are on Qbox, whichever export
-- happens to answer.
function adapter.detect()
    return GetResourceState('qbx_core') == 'started'
end

function adapter.init()
    -- Try the native export first, then the compatibility one. Older Qbox
    -- builds only expose GetCoreObject through qb-core.
    for _, attempt in ipairs({
        { 'qbx_core', 'GetCoreObject' },
        { 'qb-core', 'GetCoreObject' },
    }) do
        local ok, obj = pcall(function()
            return exports[attempt[1]][attempt[2]]()
        end)
        if ok and type(obj) == 'table' then
            adapter.core = obj
            -- Rebuild the closures against the object we actually got.
            adapter.getPlayer = function(citizenid)
                return obj.Functions.GetPlayerByCitizenId(citizenid)
            end
            adapter.getOnline = function()
                local out = {}
                for src, player in pairs(obj.Functions.GetQBPlayers()) do
                    out[player.PlayerData.citizenid] = src
                end
                return out
            end
            adapter.dumpShared = function()
                if not obj.Shared then return {} end
                return {
                    ['jobs.json'] = obj.Shared.Jobs,
                    ['gangs.json'] = obj.Shared.Gangs,
                    ['items.json'] = obj.Shared.Items,
                    ['vehicles.json'] = obj.Shared.Vehicles,
                }
            end
            return true
        end
    end
    return false
end

Bridge.register(adapter)
