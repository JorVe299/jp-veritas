-- veritas/bridge/esx.lua
-- ESX Legacy.
--
-- This is the adapter that differs most, and not only in wording:
--
--   * A character is keyed on `identifier` (license:...), not on a
--     citizenid. identityKey tells the backend which column to query.
--   * Money lives in accounts named 'money' and 'bank'; the panel speaks
--     'cash' and 'bank', so the names are mapped here.
--   * There are no gangs and no shared vehicle list. Those dumps stay empty
--     and the panel shows the modules as unavailable rather than guessing.
--   * Metadata exists only in newer builds (setMeta). Where it is missing we
--     return false, and the route says so instead of reporting success.

local ESX

local ACCOUNTS = {
    cash = 'money',
    bank = 'bank',
    black = 'black_money',
}

local adapter = {
    id = 'esx',
    label = 'ESX Legacy (es_extended)',
    identityKey = 'identifier',
}

function adapter.detect()
    return GetResourceState('es_extended') == 'started'
end

function adapter.init()
    -- Newer ESX exposes the object directly; older builds only fire an event.
    local ok, obj = pcall(function()
        return exports['es_extended']:getSharedObject()
    end)
    if ok and type(obj) == 'table' then
        ESX = obj
        return true
    end

    -- Fallback for builds that predate the export.
    TriggerEvent('esx:getSharedObject', function(o) ESX = o end)
    return type(ESX) == 'table'
end

function adapter.getPlayer(identifier)
    if not ESX then return nil end
    return ESX.GetPlayerFromIdentifier(identifier)
end

function adapter.getSource(xPlayer)
    return xPlayer.source
end

function adapter.getOnline()
    local out = {}
    -- GetExtendedPlayers hands back the objects; GetPlayers only sources.
    if ESX.GetExtendedPlayers then
        for _, xPlayer in pairs(ESX.GetExtendedPlayers()) do
            out[xPlayer.identifier] = xPlayer.source
        end
    else
        for _, src in pairs(ESX.GetPlayers()) do
            local xPlayer = ESX.GetPlayerFromId(src)
            if xPlayer then out[xPlayer.identifier] = src end
        end
    end
    return out
end

function adapter.addMoney(xPlayer, account, amount, reason)
    xPlayer.addAccountMoney(ACCOUNTS[account] or account, amount, reason)
    return true
end

function adapter.removeMoney(xPlayer, account, amount, reason)
    local name = ACCOUNTS[account] or account
    local acc = xPlayer.getAccount(name)
    -- ESX happily goes negative; the panel should not be the thing that
    -- lets an account underflow.
    if not acc or acc.money < amount then return false end
    xPlayer.removeAccountMoney(name, amount, reason)
    return true
end

function adapter.setJob(xPlayer, name, grade)
    xPlayer.setJob(name, grade)
    return true
end

function adapter.setMetadata(xPlayer, key, value)
    -- Only ESX 1.9 and later have metadata at all.
    if type(xPlayer.setMeta) ~= 'function' then return false end
    xPlayer.setMeta(key, value)
    return true
end

function adapter.revive(xPlayer, src)
    TriggerClientEvent('esx_ambulancejob:revive', src)
    TriggerClientEvent('esx:revive', src)
    return true
end

function adapter.heal(xPlayer, src, withArmor)
    local ped = GetPlayerPed(src)
    SetEntityHealth(ped, 200)
    if withArmor then SetPedArmour(ped, 100) end

    -- The status values live in esx_status, not on the player object.
    if GetResourceState('esx_status') == 'started' then
        TriggerClientEvent('esx_status:set', src, 'hunger', 1000000)
        TriggerClientEvent('esx_status:set', src, 'thirst', 1000000)
        TriggerClientEvent('esx_status:set', src, 'stress', 0)
    end
    return true
end

function adapter.notify(src, message, kind)
    TriggerClientEvent('esx:showNotification', src, message)
    return true
end

function adapter.dumpShared()
    if not ESX then return {} end

    local jobs = {}
    if ESX.GetJobs then
        -- ESX grades are an array with a `grade` field; the panel expects a
        -- map keyed by grade level, the same shape QBCore uses.
        for name, job in pairs(ESX.GetJobs()) do
            local grades = {}
            for _, g in pairs(job.grades or {}) do
                grades[tostring(g.grade)] = { name = g.label or g.name, payment = g.salary }
            end
            jobs[name] = { label = job.label, grades = grades }
        end
    end

    local items = {}
    for name, item in pairs(ESX.Items or {}) do
        items[name] = { label = item.label, weight = item.weight, unique = item.rare }
    end

    -- No gangs and no shared vehicle list in ESX. Empty files are written
    -- so the backend can tell "nothing there" from "never ran".
    return {
        ['jobs.json'] = jobs,
        ['items.json'] = items,
        ['gangs.json'] = {},
        ['vehicles.json'] = {},
    }
end

Bridge.register(adapter)
