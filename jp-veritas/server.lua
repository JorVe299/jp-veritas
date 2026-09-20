local QBCore = exports['qb-core']:GetCoreObject() -- Qbox Export

-- Die Bridge hängt am HTTP Server von FiveM selbst (Standard 30120).
-- Erreichbar unter http://<server>:30120/<resource-name>/<route>

-- Helper: Antwort immer als JSON mit passendem Content-Type senden
local function sendJson(res, payload, status)
    res.writeHead(status or 200, { ['Content-Type'] = 'application/json' })
    res.send(json.encode(payload))
end

SetHttpHandler(function(req, res)
    local path = req.path
    local method = req.method

    -- Check: Ist Spieler Online?
    if path == '/check-online' and method == 'POST' then
        req.setDataHandler(function(body)
            local data = json.decode(body)
            local target = QBCore.Functions.GetPlayerByCitizenId(data.citizenid)

            local response = { isOnline = (target ~= nil) }
            if target then response.source = target.PlayerData.source end

            sendJson(res, response)
        end)
        return
    end

    -- Aktion: Live Update Geld
    if path == '/update-money' and method == 'POST' then
        req.setDataHandler(function(body)
            local data = json.decode(body)
            local player = QBCore.Functions.GetPlayerByCitizenId(data.citizenid)

            if not player then
                sendJson(res, { success = false, msg = "Player offline" })
                return
            end

            -- type kommt vom Backend ('cash' oder 'bank'), Fallback bank
            local moneyType = data.type or 'bank'
            local amount = tonumber(data.amount) or 0

            -- AddMoney akzeptiert keine negativen Beträge -> abziehen explizit
            local ok
            if amount >= 0 then
                ok = player.Functions.AddMoney(moneyType, amount, 'veritas-panel')
            else
                ok = player.Functions.RemoveMoney(moneyType, math.abs(amount), 'veritas-panel')
            end

            if ok == false then
                sendJson(res, { success = false, msg = "Transaction rejected (insufficient funds?)" })
            else
                sendJson(res, { success = true, msg = "Live updated" })
            end
        end)
        return
    end

    -- Aktion: Live Update Job
    if path == '/update-job' and method == 'POST' then
        req.setDataHandler(function(body)
            local data = json.decode(body)
            local player = QBCore.Functions.GetPlayerByCitizenId(data.citizenid)

            if not player then
                sendJson(res, { success = false, msg = "Player offline" })
                return
            end

            -- Der Core baut die Job-Struktur selbst korrekt zusammen
            player.Functions.SetJob(data.jobName, tonumber(data.gradeLevel) or 0)
            sendJson(res, { success = true, msg = "Live updated" })
        end)
        return
    end

    -- Aktion: Live Update Inventar
    -- Muss zwingend über den Core/das Inventar laufen: schriebe das Backend
    -- direkt in die DB, überschriebe der Server das beim nächsten Speichern.
    if path == '/update-inventory' and method == 'POST' then
        req.setDataHandler(function(body)
            local data = json.decode(body)
            local player = QBCore.Functions.GetPlayerByCitizenId(data.citizenid)

            if not player then
                sendJson(res, { success = false, msg = "Player offline" })
                return
            end

            local src = player.PlayerData.source
            local item = data.item
            local count = tonumber(data.amount) or 0
            local useOx = GetResourceState('ox_inventory') == 'started'
            local ok

            if data.action == 'add' then
                if useOx then
                    ok = exports.ox_inventory:AddItem(src, item, count)
                else
                    ok = player.Functions.AddItem(item, count, data.slot)
                end
            elseif data.action == 'remove' then
                if useOx then
                    ok = exports.ox_inventory:RemoveItem(src, item, count)
                else
                    ok = player.Functions.RemoveItem(item, count, data.slot)
                end
            elseif data.action == 'set' then
                -- Kein Core bietet "setze auf genau N" an, also Differenz bilden
                local current
                if useOx then
                    current = exports.ox_inventory:GetItemCount(src, item) or 0
                else
                    local found = player.Functions.GetItemByName(item)
                    current = found and found.amount or 0
                end

                local diff = count - current
                if diff > 0 then
                    ok = useOx and exports.ox_inventory:AddItem(src, item, diff)
                        or player.Functions.AddItem(item, diff)
                elseif diff < 0 then
                    ok = useOx and exports.ox_inventory:RemoveItem(src, item, -diff)
                        or player.Functions.RemoveItem(item, -diff)
                else
                    ok = true -- steht schon auf dem Zielwert
                end
            else
                sendJson(res, { success = false, msg = "Unknown action: " .. tostring(data.action) })
                return
            end

            if ok == false then
                sendJson(res, { success = false, msg = "The inventory rejected the action (full, or item not present?)" })
            else
                sendJson(res, { success = true, msg = "Live updated", inventory = useOx and 'ox_inventory' or 'qb-inventory' })
            end
        end)
        return
    end

    -- Aktion: Live Update Metadaten (Lizenzen, Hunger, Stress, ...)
    if path == '/update-metadata' and method == 'POST' then
        req.setDataHandler(function(body)
            local data = json.decode(body)
            local player = QBCore.Functions.GetPlayerByCitizenId(data.citizenid)

            if not player then
                sendJson(res, { success = false, msg = "Player offline" })
                return
            end

            -- Zwei Aufrufformen: ein einzelner Schlüssel mit Wert (Lizenzen),
            -- oder mehrere Felder auf einmal (Statuswerte).
            if data.key ~= nil then
                player.Functions.SetMetaData(data.key, data.value)
            elseif type(data.fields) == 'table' then
                for field, value in pairs(data.fields) do
                    player.Functions.SetMetaData(field, value)
                end
            else
                sendJson(res, { success = false, msg = "Neither key nor fields given" })
                return
            end

            sendJson(res, { success = true, msg = "Live updated" })
        end)
        return
    end

    -- Route: Gibt alle Online CitizenIDs zurück
    if path == '/get-online-players' and method == 'GET' then
        local onlinePlayers = {}
        local players = QBCore.Functions.GetQBPlayers() -- Qbox/QB Funktion

        for source, player in pairs(players) do
            onlinePlayers[player.PlayerData.citizenid] = source
        end

        sendJson(res, onlinePlayers)
        return
    end

    sendJson(res, { error = "Route not found" }, 404)
end)

-- -- Command: /refreshwebdata
-- -- Exportiert Shared Tables zu JSON Files im Resource Ordner
-- RegisterCommand('refreshwebdata', function(source, args)
--     if source ~= 0 then return end -- Nur Konsole erlaubt

--     local path = GetResourcePath(GetCurrentResourceName())

--     -- Daten sammeln
--     local dataToDump = {
--         ['jobs.json'] = QBCore.Shared.Jobs,
--         ['vehicles.json'] = QBCore.Shared.Vehicles,
--         ['items.json'] = QBCore.Shared.Items
--     }

--     for filename, data in pairs(dataToDump) do
--         -- Speichern im Root der Resource
--         SaveResourceFile(GetCurrentResourceName(), filename, json.encode(data, { indent = true }), -1)
--         print('^2[WebPanel] ^7Exported ' .. filename)
--     end
-- end, true)

AddEventHandler('onResourceStart', function(resource)
    if GetCurrentResourceName() ~= resource then return end

    local path = GetResourcePath(GetCurrentResourceName())

    -- Daten sammeln
    local dataToDump = {
        ['jobs.json'] = QBCore.Shared.Jobs,
        ['vehicles.json'] = QBCore.Shared.Vehicles,
        ['items.json'] = QBCore.Shared.Items
    }

    for filename, data in pairs(dataToDump) do
        -- Speichern im Root der Resource
        SaveResourceFile(GetCurrentResourceName(), filename, json.encode(data, { indent = true }), -1)
        print('^2[WebPanel] ^7Exported ' .. filename)
    end

    -- Dem Backend Bescheid geben (Fire & Forget)
    PerformHttpRequest('http://localhost:3001/api/system/refresh', function(err, text, headers)
        if err == 200 then
            print('^2[WebPanel] ^7Backend synced successfully.')
        else
            print('^1[WebPanel] ^7Could not sync with Backend (Is it running?)')
        end
    end, 'POST', '', { ['Content-Type'] = 'application/json' })
end)
