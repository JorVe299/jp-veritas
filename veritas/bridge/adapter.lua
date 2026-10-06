-- Adapter contract and registry: one file per framework instead of branches in the routes

Bridge = {
    adapters = {},   -- id -> adapter
    active = nil,    -- selected at startup
}

-- Unsupported operations return false/nil: the route reports "not supported", never success
-- Items live in bridge/items.lua: the inventory resource matters more there than the core

---@class VeritasAdapter
---@field id string e.g. 'qbox'
---@field label string shown in the panel diagnostics
---@field identityKey 'citizenid'|'identifier' column the backend keys characters on
---@field detect fun(): boolean
---@field init fun(): boolean grabs the core object; false if unreachable
---@field getPlayer fun(id: string): table|nil
---@field getSource fun(player: table): number
---@field getOnline fun(): table<string, number> id -> source
---@field addMoney fun(player: table, account: string, amount: number, reason: string): boolean
---@field removeMoney fun(player: table, account: string, amount: number, reason: string): boolean
---@field setJob fun(player: table, name: string, grade: number): boolean
---@field setMetadata fun(player: table, key: string, value: any): boolean
---@field revive fun(player: table, src: number): boolean
---@field heal fun(player: table, src: number, withArmor: boolean): boolean
---@field notify fun(src: number, message: string, kind: string): boolean
---@field deleteCharacter fun(id: string): boolean hands off to the core; may finish asynchronously
---@field dumpShared fun(): table<string, table> file name -> data, e.g. ['jobs.json']

---@param adapter VeritasAdapter
function Bridge.register(adapter)
    Bridge.adapters[adapter.id] = adapter
end

-- Config.Framework wins; else the first detect() hit in fixed ORDER (not table order)
local ORDER = { 'qbox', 'qbcore', 'esx', 'custom' }

function Bridge.select()
    local wanted = Config and Config.Framework or 'auto'

    if wanted ~= 'auto' then
        local a = Bridge.adapters[wanted]
        if not a then
            print(('^1[Veritas] ^7Config.Framework is "%s", but no adapter of that name is registered.'):format(wanted))
            return nil
        end
        if not a.init() then
            print(('^1[Veritas] ^7Adapter "%s" was selected but could not reach its core.'):format(wanted))
            return nil
        end
        Bridge.active = a
        print(('^2[Veritas] ^7Framework: %s (set in config)'):format(a.label))
        return a
    end

    for _, id in ipairs(ORDER) do
        local a = Bridge.adapters[id]
        if a and a.detect() then
            if a.init() then
                Bridge.active = a
                print(('^2[Veritas] ^7Framework detected: %s'):format(a.label))
                return a
            end
            print(('^3[Veritas] ^7%s looks present but its core did not answer - trying the next one.'):format(a.label))
        end
    end

    print('^1[Veritas] ^7No supported framework found. Set Config.Framework by hand, or fill in bridge/custom.lua.')
    return nil
end

-- Active adapter, or nil plus a message for the panel
function Bridge.require()
    if Bridge.active then return Bridge.active end
    return nil, 'No framework adapter is active on the FiveM server'
end
