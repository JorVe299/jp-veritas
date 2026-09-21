-- veritas/bridge/adapter.lua
-- The contract every framework adapter fulfils, plus the registry that picks
-- one at startup.
--
-- Why an adapter at all: the panel asks the same handful of questions of
-- every framework - who is online, give them money, set their job. Only the
-- wording differs. Keeping that wording in one file per framework means a
-- new core is a new file, not a new set of if-branches through the routes.

Bridge = {
    adapters = {},   -- id -> adapter
    active = nil,    -- the one that was picked
}

-- Every adapter provides these. Anything it cannot do returns nil, and the
-- route above turns that into an honest "not supported by this framework"
-- rather than pretending it worked.
--
--   id            string, e.g. 'qbox'
--   label         human readable, appears in the panel diagnostics
--   identityKey   'citizenid' for the QB family, 'identifier' for ESX -
--                 the backend needs to know which column it is keyed on
--   detect()      -> boolean   is this framework running?
--   init()        -> boolean   grab the core object; false if that failed
--   getPlayer(id) -> player | nil
--   getSource(p)  -> number
--   getOnline()   -> { [id] = source }
--   addMoney(p, account, amount, reason)    -> boolean
--   removeMoney(p, account, amount, reason) -> boolean
--   setJob(p, name, grade)                  -> boolean
--   setMetadata(p, key, value)              -> boolean
--   revive(p, src)                          -> boolean
--   heal(p, src, withArmor)                 -> boolean
--   notify(src, message, kind)              -> boolean
--   dumpShared() -> { ['jobs.json'] = table, ... }
--
-- Items are handled centrally in items.lua, because which inventory resource
-- runs matters more there than which core does.

function Bridge.register(adapter)
    Bridge.adapters[adapter.id] = adapter
end

-- Picks the adapter. An explicit Config.Framework wins; otherwise the first
-- one whose detect() says yes, in a fixed order so the result does not
-- depend on table iteration order.
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

-- Small helper for the routes: the active adapter, or nil with a message
-- the caller can pass straight back to the panel.
function Bridge.require()
    if Bridge.active then return Bridge.active end
    return nil, 'No framework adapter is active on the FiveM server'
end
