-- Local extensions; ships as an empty template (guide: BACKEND.md §2)
-- Own routes: Veritas.route(method, path, handler(body, res), opts)
-- Own framework: fill in the adapter below and set Config.Framework = 'custom'

local adapter = {
    id = 'custom',
    label = 'Custom framework',

    -- 'citizenid' or 'identifier': the column the database keys characters on
    identityKey = 'citizenid',
}

function adapter.detect()
    -- true when your framework runs; false keeps auto-detection from picking this template
    return false
end

function adapter.init()
    -- Fetch the core object; false if unreachable
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
function adapter.deleteCharacter(_) return false end

function adapter.dumpShared()
    -- { ['file.json'] = table }: written as JSON, read by the backend for the pickers
    return {}
end

Bridge.register(adapter)
