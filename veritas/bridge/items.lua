-- veritas/bridge/items.lua
-- Inventory access, kept apart from the framework adapters.
--
-- The reason: which inventory resource runs matters more here than which
-- core does. A Qbox server and an ESX server both commonly run
-- ox_inventory, and then the item calls are identical while everything else
-- differs. Splitting it this way means one implementation instead of three.

Items = {}

-- Detected once at startup and reported in /status, so the panel can say
-- which inventory it is actually talking to.
function Items.detect()
    if GetResourceState('ox_inventory') == 'started' then return 'ox_inventory' end
    if GetResourceState('qb-inventory') == 'started' then return 'qb-inventory' end
    if GetResourceState('qs-inventory') == 'started' then return 'qs-inventory' end
    return 'core'
end

local kind = nil
local function inventory()
    if not kind then kind = Items.detect() end
    return kind
end

function Items.add(player, src, name, count, slot)
    if inventory() == 'ox_inventory' then
        return exports.ox_inventory:AddItem(src, name, count) ~= false
    end
    if type(player.Functions) == 'table' then
        return player.Functions.AddItem(name, count, slot) ~= false
    end
    -- ESX without ox_inventory
    if type(player.addInventoryItem) == 'function' then
        player.addInventoryItem(name, count)
        return true
    end
    return false
end

function Items.remove(player, src, name, count, slot)
    if inventory() == 'ox_inventory' then
        return exports.ox_inventory:RemoveItem(src, name, count) ~= false
    end
    if type(player.Functions) == 'table' then
        return player.Functions.RemoveItem(name, count, slot) ~= false
    end
    if type(player.removeInventoryItem) == 'function' then
        player.removeInventoryItem(name, count)
        return true
    end
    return false
end

function Items.count(player, src, name)
    if inventory() == 'ox_inventory' then
        return exports.ox_inventory:GetItemCount(src, name) or 0
    end
    if type(player.Functions) == 'table' then
        local found = player.Functions.GetItemByName(name)
        return found and found.amount or 0
    end
    if type(player.getInventoryItem) == 'function' then
        local found = player.getInventoryItem(name)
        return found and found.count or 0
    end
    return 0
end

-- No core offers "set to exactly N", so the difference is worked out here.
-- Doing it in one place keeps the three adapters from each getting it
-- slightly wrong in their own way.
function Items.set(player, src, name, target, slot)
    local current = Items.count(player, src, name)
    local diff = target - current

    if diff > 0 then return Items.add(player, src, name, diff, slot) end
    if diff < 0 then return Items.remove(player, src, name, -diff, slot) end
    return true
end
