-- Qbox: QBCore fork via qbx_core; detected before QBCore so it is not mistaken for it

local adapter = QBFamily.build('qbox', 'Qbox (qbx_core)', 'qbx_core', 'GetCoreObject')

-- qbx_core running = Qbox, whichever export answers (qb-core keeps a compatibility export)
function adapter.detect()
    return GetResourceState('qbx_core') == 'started'
end

function adapter.init()
    -- Native export first; older Qbox builds expose GetCoreObject only via qb-core
    for _, attempt in ipairs({
        { 'qbx_core', 'GetCoreObject' },
        { 'qb-core', 'GetCoreObject' },
    }) do
        local ok, obj = pcall(function()
            return exports[attempt[1]][attempt[2]]()
        end)
        if ok and type(obj) == 'table' then
            adapter.core = obj
            -- Rebind the closures to the object that answered
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
