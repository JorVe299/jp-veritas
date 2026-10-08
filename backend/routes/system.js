// Diagnostics and maintenance; verbose on purpose: most faults here are otherwise silent
const express = require('express');
const axios = require('axios');
const { getTableColumns, tableExists, clearSchemaCache, listTables } = require('../utils/dbHandler');
const { loadGameData, getJobs, getItems, getVehicles } = require('../utils/dataLoader');
const { FIVEM_API_URL, BRIDGE_TIMEOUT, fetchStatus, HAS_TOKEN } = require('../utils/bridge');
const txadmin = require('../utils/txadmin');
const { identifiersOf, discordOf } = require('../utils/identity');
const { checkDatabaseMatchesServer } = require('./players');
const { oncePer } = require('../utils/rateLimit');

const router = express.Router();

// Tables and columns the management modules rely on
const REQUIRED = {
    players: ['citizenid', 'charinfo', 'job', 'money', 'inventory', 'metadata'],
    player_vehicles: ['citizenid', 'vehicle', 'plate', 'garage', 'state'],
};

// Raw bridge answer, cross-checked with the DB (debugs "everyone shows as offline")
router.get('/api/system/bridge', async (req, res) => {
    const url = `${FIVEM_API_URL}/get-online-players`;
    const started = Date.now();

    try {
        const r = await axios.get(url, { timeout: BRIDGE_TIMEOUT });
        const isObject = r.data && typeof r.data === 'object' && !Array.isArray(r.data);
        const onlineIDs = isObject ? r.data : {};

        // Tells "really offline" apart from "wrong database"
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
            // Lua encodes an empty table as []: nobody online
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

// Tables and columns found: can vehicle and inventory management work on this schema?
router.get('/api/system/schema', async (req, res) => {
    try {
        clearSchemaCache(); // diagnostics: always read fresh

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
            // Full list: which further modules this schema could support
            allTables: await listTables(),
            // ?inspect=a,b,c adds the columns of further tables
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
        // Names from the URL are bound parameters in getTableColumns: no interpolation
        out[name] = await getTableColumns(name);
    }
    return names.length ? out : undefined;
}

// Bridge self-report: framework, inventory, token agreement
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

// txAdmin store reachability and path, for the operator; the portal only says "could not be read"
router.get('/api/system/txadmin', async (req, res) => {
    try {
        // ?citizenid= / ?discord=: why a stored ban does not match this person
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
            // "found nothing" vs "never looked"
            searched: state.available ? undefined : 'TXADMIN_DB_PATH, then a txData folder near the panel',
            hintForMatching: 'Add ?citizenid=XXXX to see why a particular person does or does not match.',
        });
    } catch (e) {
        console.error('[System] txAdmin check failed:', e.message);
        res.status(500).json({ available: false, reason: 'The txAdmin check itself failed', hint: e.message });
    }
});

// The describe() report as one actionable sentence
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

// Reloads the catalog JSON without a restart; a session with system.edit or the resource
// secret, held to one call a minute per caller (BACKEND.md §5)
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
