-- Inventory access, apart from the adapters: ox_inventory calls are the same on every core

Items = {}

-- Reported in /status: which inventory the panel is talking to
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

-- ox_inventory's own list: weapons and ammo included, which core item tables may lack
-- Plain fields only: item entries carry functions json.encode cannot write
function Items.catalog()
    if inventory() ~= 'ox_inventory' then return nil end
    local ok, list = pcall(function() return exports.ox_inventory:Items() end)
    if not ok or type(list) ~= 'table' then return nil end

    local out = {}
    for name, item in pairs(list) do
        out[name] = {
            name = name,
            label = item.label,
            weight = item.weight,
            unique = item.stack == false or item.weapon == true,
            weapon = item.weapon == true or nil,
            description = item.description,
        }
    end
    return out
end

function Items.add(player, src, name, count, slot)
    if inventory() == 'ox_inventory' then
        -- Slot from a drop onto the grid; nil lets ox pick the first fitting one
        return exports.ox_inventory:AddItem(src, name, count, nil, tonumber(slot)) ~= false
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

-- No core offers "set to N": computed once here from count, add and remove
function Items.set(player, src, name, target, slot)
    local current = Items.count(player, src, name)
    local diff = target - current

    if diff > 0 then return Items.add(player, src, name, diff, slot) end
    if diff < 0 then return Items.remove(player, src, name, -diff, slot) end
    return true
end
