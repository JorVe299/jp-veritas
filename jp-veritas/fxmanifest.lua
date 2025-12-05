fx_version 'cerulean'
game 'gta5'
lua54 'yes' -- Wichtig: Qbox und moderne Syntax benötigen Lua 5.4

author 'JP5M'
description 'Web Panel Bridge for Veritas'
version '1.0.0'

-- Stellt sicher, dass Qbox Core geladen ist, bevor diese Resource startet
dependency 'qbx_core'

server_script 'server.lua'

-- Definiert die Dateien, die erstellt/gelesen werden sollen
files {
    'jobs.json',
    'items.json',
    'vehicles.json'
}