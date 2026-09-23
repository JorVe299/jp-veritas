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
const { fetchStatus, HAS_TOKEN } = require('../utils/bridge');
const { identifiersOf, discordOf } = require('../utils/identity');
const { checkDatabaseMatchesServer } = require('./players');
const { oncePer } = require('../utils/rateLimit');

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

// What the bridge reports about itself: which framework it found, which
// inventory, and whether the two ends agree about the token. It used to
// live with the resource browser, which is gone; it belongs here, with
// everything else that answers "is this installation wired up right".
router.get('/api/system/framework', async (req, res) => {
    const status = await fetchStatus();

    if (!status.reachable) {
        return res.status(502).json({
            reachable: false,
            error: status.error,
            hint: 'Without the bridge the panel still works from the database, but live actions do not.',
        });
    }

    res.json({
        ...status,
        backendHasToken: HAS_TOKEN,
        tokenMatchLikely: HAS_TOKEN === Boolean(status.tokenConfigured),
    });
});

// Whether txAdmin's ban record can be reached, and from where.
//
// Veritas ID answers this per player, but only ever to that player and only
// as "could not be read". Whoever runs the server needs the other half: the
// path that was tried and why it did not work. That belongs here, with the
// rest of the diagnostics, not in front of a citizen.
router.get('/api/system/txadmin', async (req, res) => {
    try {
        // With ?citizenid= or ?discord= this answers the harder question:
        // the store is readable and the ban is in it, so why does the
        // person it was issued against not see it? Matching happens on
        // identifiers, and neither side of that comparison is visible
        // from outside - so both are printed here.
        const { citizenid } = req.query;
        let discord = req.query.discord;
        if (!discord && citizenid) discord = await discordOf(String(citizenid));

        if (discord) {
            const identifiers = await identifiersOf(String(discord));
            if (identifiers === null) {
                return res.status(400).json({ error: 'That Discord id is malformed' });
            }
            const report = await txadmin.describe(identifiers);
            return res.json({
                ...report,
                configured: Boolean((process.env.TXADMIN_DB_PATH || '').trim()),
                showsBanAuthor: txadmin.SHOW_AUTHOR,
                asked: { citizenid: citizenid || null, discordId: String(discord) },
                verdict: verdictFor(report),
            });
        }

        const state = await txadmin.status();
        res.json({
            ...state,
            configured: Boolean((process.env.TXADMIN_DB_PATH || '').trim()),
            showsBanAuthor: txadmin.SHOW_AUTHOR,
            // So a reader can tell "found nothing" from "never looked".
            searched: state.available ? undefined : 'TXADMIN_DB_PATH, then a txData folder near the panel',
            hintForMatching: 'Add ?citizenid=XXXX to see why a particular person does or does not match.',
        });
    } catch (e) {
        console.error('[System] txAdmin check failed:', e.message);
        res.status(500).json({ available: false, reason: 'The txAdmin check itself failed', hint: e.message });
    }
});

// The check turned into one sentence, because a table of identifiers is
// not an answer - it is the material for one.
function verdictFor(report) {
    if (!report.available) return report.reason;

    const ids = report.account.identifiers;
    if (report.account.matched > 0) {
        return `${report.account.matched} of this account's ${ids.length} identifier(s) appear in the store. Anything still missing from the portal is a ban/warning split or a stale frontend build, not a matching problem.`;
    }
    if (report.store.actions === 0) {
        return 'The store is readable but holds no actions at all.';
    }
    if (report.store.bans === 0) {
        return `The store holds ${report.store.warns} warning(s) and no bans. The portal shows bans only.`;
    }
    const kinds = report.store.identifierKinds.join(', ');
    const mine = [...new Set(ids.map(i => i.id.split(':')[0]))].join(', ');
    return `None of this account's identifiers appear in the store. It keys actions by [${kinds}]; this account resolves to [${mine}]. If the ban was issued against an identifier the users table does not hold, the two can never meet.`;
}

// Route for reloading the JSON data without a restart. Once a minute per
// person: it rereads every catalog file, and the button that calls it is
// not the only way to send it.
router.post('/api/system/refresh', oncePer('system.refresh', 60_000), (req, res) => {
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
