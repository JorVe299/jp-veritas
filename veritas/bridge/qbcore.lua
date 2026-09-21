-- veritas/bridge/qbcore.lua
-- QBCore and Qbox share almost everything: both expose a core object with
-- the same Functions table. They differ in the export used to reach it, and
-- Qbox additionally keeps memberships in player_groups.
--
-- The shared part lives here; qbox.lua only supplies the different export
-- and label and reuses these functions.

local function build(id, label, resourceName, exportName)
    local core

    local adapter = {
        id = id,
        label = label,
        identityKey = 'citizenid',
    }

    function adapter.detect()
        return GetResourceState(resourceName) == 'started'
    end

    function adapter.init()
        -- pcall, because reaching for an export of a resource that is
        -- present but not finished loading throws rather than returning nil.
        local ok, obj = pcall(function()
            return exports[resourceName][exportName]()
        end)
        if not ok or type(obj) ~= 'table' then return false end
        core = obj
        return true
    end

    function adapter.getPlayer(citizenid)
        if not core then return nil end
        return core.Functions.GetPlayerByCitizenId(citizenid)
    end

    function adapter.getSource(player)
        return player.PlayerData.source
    end

    function adapter.getOnline()
        local out = {}
        local players = core.Functions.GetQBPlayers()
        for src, player in pairs(players) do
            out[player.PlayerData.citizenid] = src
        end
        return out
    end

    -- AddMoney refuses negative amounts, so subtracting is its own call.
    function adapter.addMoney(player, account, amount, reason)
        return player.Functions.AddMoney(account, amount, reason) ~= false
    end

    function adapter.removeMoney(player, account, amount, reason)
        return player.Functions.RemoveMoney(account, amount, reason) ~= false
    end

    function adapter.setJob(player, name, grade)
        player.Functions.SetJob(name, grade)
        return true
    end

    function adapter.setMetadata(player, key, value)
        player.Functions.SetMetaData(key, value)
        return true
    end

    function adapter.revive(player, src)
        -- Which event applies depends on the ambulance script. Both common
        -- names are fired; the one that does not fit goes nowhere.
        TriggerClientEvent('hospital:client:Revive', src)
        TriggerClientEvent('qbx_medical:client:playerRevived', src)
        player.Functions.SetMetaData('isdead', false)
        player.Functions.SetMetaData('inlaststand', false)
        return true
    end

    function adapter.heal(player, src, withArmor)
        local ped = GetPlayerPed(src)
        SetEntityHealth(ped, 200)
        if withArmor then
            SetPedArmour(ped, 100)
            player.Functions.SetMetaData('armor', 100)
        end
        player.Functions.SetMetaData('hunger', 100)
        player.Functions.SetMetaData('thirst', 100)
        player.Functions.SetMetaData('stress', 0)
        return true
    end

    function adapter.notify(src, message, kind)
        TriggerClientEvent('QBCore:Notify', src, message, kind or 'inform')
        return true
    end

    function adapter.dumpShared()
        if not core or not core.Shared then return {} end
        return {
            ['jobs.json'] = core.Shared.Jobs,
            ['gangs.json'] = core.Shared.Gangs,
            ['items.json'] = core.Shared.Items,
            ['vehicles.json'] = core.Shared.Vehicles,
        }
    end

    return adapter
end

-- Exported so qbox.lua can build on the same functions.
QBFamily = { build = build }

Bridge.register(build('qbcore', 'QBCore (qb-core)', 'qb-core', 'GetCoreObject'))
