fx_version 'cerulean'
game 'gta5'
lua54 'yes' -- required by Qbox and by the bitwise operators in server.lua

author 'JP5M'
description 'Web Panel Bridge for Veritas'
version '2.0.0'

-- No core dependency: detected at runtime, so one resource runs on Qbox, QBCore and ESX

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

-- Dumps written at start and read by the backend
files {
    'jobs.json',
    'items.json',
    'vehicles.json',
    'gangs.json'
}
