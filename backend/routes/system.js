// backend/routes/system.js
// Diagnostics and maintenance. Deliberately verbose: almost every fault in
// this project so far has been silent - a bridge that does not answer and a
// database that does not belong to the game server look identical from the
// outside.
const express = require('express');
const axios = require('axios');
const { getTableColumns, tableExists, clearSchemaCache, listTables } = require('../utils/dbHandler');
const { loadGameData, getJobs, getItems, getVehicles } = require('../utils/dataLoader');
const { FIVEM_API_URL, BRIDGE_TIMEOUT } = require('../utils/bridge');
const txadmin = require('../utils/txadmin');
const { checkDatabaseMatchesServer } = require('./players');

const router = express.Router();

// Tables and columns the management modules rely on
const REQUIRED = {
    players: ['citizenid', 'charinfo', 'job', 'money', 'inventory', 'metadata'],
    player_vehicles: ['citizenid', 'vehicle', 'plate', 'garage', 'state'],
};

// Shows exactly what the bridge answers and checks it against the database.
// Meant for debugging "every player shows up as offline".
router.get('/api/system/bridge', async (req, res) => {
    const url = `${FIVEM_API_URL}/get-online-players`;
    const started = Date.now();

    try {
        const r = await axios.get(url, { timeout: BRIDGE_TIMEOUT });
        const isObject = r.data && typeof r.data === 'object' && !Array.isArray(r.data);
        const onlineIDs = isObject ? r.data : {};

        // Cross-check against the database - this is where "the player
        // really is offline" parts ways with "wrong database"
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
            // Lua turns an empty table into [] - then simply nobody is online
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

// Which tables and columns does the backend actually find?
// This settles up front whether vehicle and inventory management can work
// on this schema at all.
router.get('/api/system/schema', async (req, res) => {
    try {
        clearSchemaCache(); // deliberately read fresh, this is a diagnostics route

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
            tables: report,
            // The full list, so it is visible which further modules this
            // schema would support.
            allTables: await listTables(),
            // ?inspect=a,b,c shows the columns of further tables - useful for
            // checking whether a module fits this schema.
            inspected: await inspectTables(req.query.inspect)
        });
    } catch (e) {
        console.error('[System] schema check failed:', e.message);
        res.status(500).json({ error: 'The schema could not be read', detail: e.code || e.message });
    }
});

async function inspectTables(raw) {
    const names = String(raw || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 20);
    const out = {};
    for (const name of names) {
        // Table names come from the URL; getTableColumns queries them as a
        // bound parameter, so no interpolation is involved here.
        out[name] = await getTableColumns(name);
    }
    return names.length ? out : undefined;
}

// Whether txAdmin's ban record can be reached, and from where.
//
// Veritas ID answers this per player, but only ever to that player and only
// as "could not be read". Whoever runs the server needs the other half: the
// path that was tried and why it did not work. That belongs here, with the
// rest of the diagnostics, not in front of a citizen.
router.get('/api/system/txadmin', async (req, res) => {
    try {
        const state = await txadmin.status();
        res.json({
            ...state,
            configured: Boolean((process.env.TXADMIN_DB_PATH || '').trim()),
            showsBanAuthor: txadmin.SHOW_AUTHOR,
            // So a reader can tell "found nothing" from "never looked".
            searched: state.available ? undefined : 'TXADMIN_DB_PATH, then a txData folder near the panel',
        });
    } catch (e) {
        console.error('[System] txAdmin check failed:', e.message);
        res.status(500).json({ available: false, reason: 'The txAdmin check itself failed', hint: e.message });
    }
});

// Route for reloading the JSON data without a restart
router.post('/api/system/refresh', (req, res) => {
    try {
        loadGameData(); // runs sync and load again
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
