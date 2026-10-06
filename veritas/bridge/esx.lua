-- ESX Legacy: characters keyed on `identifier`; panel cash/bank/black = money/bank/black_money
-- No gangs, no shared vehicle list (empty dumps); metadata only on ESX 1.9+, else false

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
    -- Newer ESX exposes the object directly; older builds only fire an event
    local ok, obj = pcall(function()
        return exports['es_extended']:getSharedObject()
    end)
    if ok and type(obj) == 'table' then
        ESX = obj
        return true
    end

    -- Builds that predate the export
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
    -- GetExtendedPlayers returns objects; GetPlayers only sources
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
    -- ESX allows negative balances; the panel refuses to underflow
    if not acc or acc.money < amount then return false end
    xPlayer.removeAccountMoney(name, amount, reason)
    return true
end

function adapter.setJob(xPlayer, name, grade)
    xPlayer.setJob(name, grade)
    return true
end

function adapter.setMetadata(xPlayer, key, value)
    -- Metadata: ESX 1.9+ only
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

    -- Status values live in esx_status, not on the player object
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

-- No core delete to hand off to; esx_multicharacter deletes from its own client flow
function adapter.deleteCharacter(_)
    return false
end

function adapter.dumpShared()
    if not ESX then return {} end

    local jobs = {}
    if ESX.GetJobs then
        -- ESX grades array -> map keyed by grade level (QBCore shape)
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

    -- Empty files, not missing ones: "nothing there" vs "never ran"
    return {
        ['jobs.json'] = jobs,
        ['items.json'] = items,
        ['gangs.json'] = {},
        ['vehicles.json'] = {},
    }
end

Bridge.register(adapter)
