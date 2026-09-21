fx_version 'cerulean'
game 'gta5'
lua54 'yes' -- Important: Qbox and modern syntax require Lua 5.4

author 'JP5M'
description 'Web Panel Bridge for Veritas'
version '2.0.0'

-- No hard dependency any more: the framework is detected at runtime, so the
-- same resource works on Qbox, QBCore and ESX. Declaring one core here would
-- stop the resource from starting on the other two.

server_scripts {
    'config.lua',
    'bridge/adapter.lua',
    'bridge/items.lua',
    'bridge/qbcore.lua',
    'bridge/qbox.lua',     -- after qbcore.lua: it builds on the shared code
    'bridge/esx.lua',
    'bridge/custom.lua',   -- last, so it can override anything above
    'server.lua',
}

-- Declares the files that get created and read
files {
    'jobs.json',
    'items.json',
    'vehicles.json',
    'gangs.json'
}
