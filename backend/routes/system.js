// backend/routes/system.js
// Diagnose und Wartung. Bewusst ausführlich: die Fehler in diesem Projekt
// waren bisher fast alle stumm - eine Bridge, die nicht antwortet, oder eine
// Datenbank, die nicht zum Gameserver gehört, sehen von außen gleich aus.
const express = require('express');
const axios = require('axios');
const { getTableColumns, tableExists, clearSchemaCache } = require('../utils/dbHandler');
const { loadGameData, getJobs, getItems, getVehicles } = require('../utils/dataLoader');
const { FIVEM_API_URL, BRIDGE_TIMEOUT } = require('../utils/bridge');
const { checkDatabaseMatchesServer } = require('./players');

const router = express.Router();

// Tabellen/Spalten, auf die sich die Verwaltungsmodule stützen
const REQUIRED = {
    players: ['citizenid', 'charinfo', 'job', 'money', 'inventory', 'metadata'],
    player_vehicles: ['citizenid', 'vehicle', 'plate', 'garage', 'state'],
};

// Zeigt genau, was die Bridge antwortet, und gleicht es gegen die DB ab.
// Gedacht zum Debuggen von "alle Spieler werden als offline angezeigt".
router.get('/api/system/bridge', async (req, res) => {
    const url = `${FIVEM_API_URL}/get-online-players`;
    const started = Date.now();

    try {
        const r = await axios.get(url, { timeout: BRIDGE_TIMEOUT });
        const isObject = r.data && typeof r.data === 'object' && !Array.isArray(r.data);
        const onlineIDs = isObject ? r.data : {};

        // Gegenprobe gegen die Datenbank - das ist der Punkt, an dem sich
        // "Spieler ist wirklich offline" von "falsche Datenbank" trennt
        let dbCheck;
        try {
            const mismatch = await checkDatabaseMatchesServer(onlineIDs);
            dbCheck = mismatch
                ? { ok: false, ...mismatch }
                : { ok: true, database: process.env.DB_NAME };
        } catch (e) {
            dbCheck = { ok: false, dbError: e.code || e.message };
        }

        res.json({
            reachable: true,
            url,
            latencyMs: Date.now() - started,
            httpStatus: r.status,
            contentType: r.headers['content-type'] || null,
            // Lua macht aus einer leeren Table [] - dann ist schlicht niemand online
            payloadShape: Array.isArray(r.data) ? 'array (= nobody online)' : typeof r.data,
            onlineCount: Object.keys(onlineIDs).length,
            citizenids: Object.keys(onlineIDs),
            raw: r.data,
            database: dbCheck
        });
    } catch (e) {
        res.status(502).json({
            reachable: false,
            url,
            latencyMs: Date.now() - started,
            code: e.code || null,
            httpStatus: e.response?.status || null,
            message: e.message,
            hint: 'Does the backend run on the same host as FiveM? Then FIVEM_API_URL should point at 127.0.0.1, not at the public IP.'
        });
    }
});

// Welche Tabellen und Spalten findet das Backend tatsächlich vor?
// Damit lässt sich vorab klären, ob Fahrzeug- und Inventarverwaltung
// auf diesem Schema überhaupt funktionieren können.
router.get('/api/system/schema', async (req, res) => {
    try {
        clearSchemaCache(); // bewusst frisch lesen, das ist eine Diagnose-Route

        const report = {};
        for (const [table, needed] of Object.entries(REQUIRED)) {
            const exists = await tableExists(table);
            const columns = exists ? await getTableColumns(table) : [];
            report[table] = {
                exists,
                missingColumns: needed.filter(c => !columns.includes(c)),
                columns
            };
        }

        const problems = Object.entries(report)
            .filter(([, r]) => !r.exists || r.missingColumns.length > 0)
            .map(([table, r]) => r.exists
                ? `${table}: missing columns ${r.missingColumns.join(', ')}`
                : `${table}: table missing`);

        res.json({
            database: process.env.DB_NAME,
            ok: problems.length === 0,
            problems,
            tables: report
        });
    } catch (e) {
        console.error('[System] schema check failed:', e.message);
        res.status(500).json({ error: 'The schema could not be read', detail: e.code || e.message });
    }
});

// Route zum Neuladen der JSON-Daten ohne Neustart
router.post('/api/system/refresh', (req, res) => {
    try {
        loadGameData(); // Führt Sync & Load erneut aus
        console.log('[System] Hot reload of the game data done.');
        res.json({
            success: true,
            message: 'Data synchronised successfully.',
            loaded: {
                jobs: Object.keys(getJobs()).length,
                items: Object.keys(getItems()).length,
                vehicles: Object.keys(getVehicles()).length
            }
        });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

module.exports = { router };
