require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const axios = require('axios');
const cors = require('cors');
const { loadGameData } = require('./utils/dataLoader');

const app = express();
app.use(cors());
app.use(express.json());

// DB Pool
const db = mysql.createPool({
    host: process.env.DB_HOST, // 'localhost'
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME // Deine Qbox DB
});

// FiveM Bridge URL (Resource auf dem Server)
// FiveM's integrierter Webserver läuft meist auf Port 30120 + Resource Name
const FIVEM_API_URL = 'http://127.0.0.1:30120/deine-bridge-resource'; 

// Route: Geld geben (Hybrid Logik)
app.post('/api/manage/money', async (req, res) => {
    const { citizenid, amount, type } = req.body; // type: 'bank' or 'cash'

    try {
        // 1. Check: Ist er online?
        // Hinweis: Authentifizierungstoken für die Bridge hier einfügen
        const onlineCheck = await axios.post(`${FIVEM_API_URL}/check-online`, { citizenid });
        
        if (onlineCheck.data.isOnline) {
            // WEG A: Live Update via Bridge
            await axios.post(`${FIVEM_API_URL}/update-money`, { citizenid, amount });
            return res.json({ status: 'success', mode: 'live', message: 'Money updated via Live API' });
        } else {
            // WEG B: SQL Update
            // Qbox speichert Geld oft als JSON in 'players' -> 'money'
            // Das ist tricky mit SQL allein, wir holen erst den String
            const [rows] = await db.execute('SELECT money FROM players WHERE citizenid = ?', [citizenid]);
            if (rows.length === 0) return res.status(404).json({ error: 'Player not found' });

            let moneyData = JSON.parse(rows[0].money);
            moneyData[type] = (moneyData[type] || 0) + amount;

            await db.execute('UPDATE players SET money = ? WHERE citizenid = ?', [JSON.stringify(moneyData), citizenid]);
            return res.json({ status: 'success', mode: 'offline', message: 'Money updated via SQL' });
        }

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

const PORT = process.env.PORT || 3001; // Backend Port
app.listen(PORT, () => {
    console.log(`Backend running on port ${PORT}`);
});

// Beim Start Daten laden
loadGameData();

// API Route für das Frontend (React braucht die Listen für Dropdowns)
app.get('/api/meta/jobs', (req, res) => {
    const { getJobs } = require('./utils/dataLoader');
    res.json(getJobs());
});

// Helper: JSON parsen wenn nötig
const parseJSON = (data) => {
    if (typeof data === 'string') {
        try { return JSON.parse(data); } catch { return {}; }
    }
    return data;
};

app.get('/api/players', async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const search = req.query.search || '';
    const offset = (page - 1) * limit;

    try {
        // 1. Hole Online-Liste von der Bridge (für den Status-Indikator)
        // Timeout kurz halten, falls Server offline ist
        let onlineIDs = {};
        try {
            const onlineRes = await axios.get(`${FIVEM_API_URL}/get-online-players`, { timeout: 1000 });
            onlineIDs = onlineRes.data;
        } catch (e) {
            console.log("FiveM Bridge nicht erreichbar (Server offline?)");
        }

        // 2. SQL Query bauen (Qbox speichert Namen in charinfo JSON)
        // Wir suchen in Vorname, Nachname oder CitizenID
        let query = `
            SELECT citizenid, charinfo, job, money 
            FROM players 
            WHERE 
                citizenid LIKE ? OR 
                JSON_UNQUOTE(JSON_EXTRACT(charinfo, '$.firstname')) LIKE ? OR 
                JSON_UNQUOTE(JSON_EXTRACT(charinfo, '$.lastname')) LIKE ?
            LIMIT ? OFFSET ?
        `;
        
        const searchTerm = `%${search}%`;
        const params = [searchTerm, searchTerm, searchTerm, limit, offset];

        // Wenn keine Suche, Query vereinfachen für Performance
        if (!search) {
            query = 'SELECT citizenid, charinfo, job, money FROM players LIMIT ? OFFSET ?';
            params.splice(0, 3); // Entferne Such-Parameter
        }

        const [rows] = await db.execute(query, params);

        // 3. Daten aufbereiten (JSON Strings -> Objekte & Online Check)
        const players = rows.map(row => {
            const char = parseJSON(row.charinfo);
            const job = parseJSON(row.job);
            const money = parseJSON(row.money);
            
            return {
                citizenid: row.citizenid,
                name: `${char.firstname} ${char.lastname}`,
                jobLabel: `${job.label} - ${job.grade?.name}`,
                money: money, // { cash: x, bank: y }
                isOnline: !!onlineIDs[row.citizenid], // true/false
                sourceID: onlineIDs[row.citizenid] || null
            };
        });

        res.json(players);

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'DB Fehler' });
    }
});

// Route zum Neuladen der JSON-Daten ohne Neustart
app.post('/api/system/refresh', (req, res) => {
    try {
        loadGameData(); // Führt Sync & Load erneut aus
        console.log('[System] Hot-Reload der Spieldaten durchgeführt.');
        res.json({ success: true, message: 'Daten erfolgreich synchronisiert.' });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});