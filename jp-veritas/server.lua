local port = 40121 -- Interner Port für die Bridge
local QBCore = exports['qbx_core']:GetCoreObject() -- Qbox Export

-- Simpler HTTP Listener via Node.js im FiveM (oder wir nutzen REST-Handler)
-- Für dieses Beispiel nutzen wir einen Command oder Export, der vom Backend via HTTP aufgerufen wird. 
-- Da natives HTTP Listening in FiveM komplex ist, ist der einfachste Weg für den Start: 
-- Das Node Backend nutzt RCON oder wir nutzen 'SetHttpHandler'.

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
            
            res.send(json.encode(response))
        end)
        return
    end

    -- Aktion: Live Update (Beispiel Geld)
    if path == '/update-money' and method == 'POST' then
        req.setDataHandler(function(body)
            local data = json.decode(body)
            local player = QBCore.Functions.GetPlayerByCitizenId(data.citizenid)
            
            if player then
                player.Functions.AddMoney('bank', data.amount)
                res.send(json.encode({success = true, msg = "Live updated"}))
            else
                res.send(json.encode({success = false, msg = "Player offline"}))
            end
        end)
        return
    end
    
    res.send(json.encode({error = "Route not found"}))
end)

-- Command: /refreshwebdata
-- Exportiert Shared Tables zu JSON Files im Resource Ordner
RegisterCommand('refreshwebdata', function(source, args)
    if source ~= 0 then return end -- Nur Konsole erlaubt

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
end, true)