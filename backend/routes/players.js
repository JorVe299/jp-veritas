// Player list and single lookup
const express = require('express');
const { db } = require('../utils/dbHandler');
const { fetchOnlinePlayers } = require('../utils/bridge');
const { profile } = require('../utils/framework');

const router = express.Router();

// Online players unknown to this DB: panel and game server read different databases
// (otherwise everyone shows as offline, with no error anywhere)
async function checkDatabaseMatchesServer(onlineIDs) {
    const ids = Object.keys(onlineIDs);
    if (ids.length === 0) return null; // nobody online -> nothing to check

    const fw = await profile();
    const placeholders = ids.map(() => '?').join(',');
    const [found] = await db.execute(
        `SELECT ${fw.idColumn} FROM ${fw.table} WHERE ${fw.idColumn} IN (${placeholders})`,
        ids
    );

    if (found.length > 0) return null; // they match

    console.warn(
        `[DB] The bridge reports ${ids.length} player(s) online (${ids.join(', ')}), ` +
        `but NONE of those citizen IDs exist in the database '${process.env.DB_NAME}'. ` +
        `The backend and the FiveM server are most likely pointing at different databases.`
    );

    return {
        onlineButUnknown: ids,
        configuredDatabase: process.env.DB_NAME,
        hint: 'None of the citizen IDs reported online exist in this database. '
            + 'Check mysql_connection_string in the server.cfg of the FiveM server.'
    };
}

// Row shape comes from the framework profile; only the online state is added here
function shapePlayer(row, onlineIDs, fw) {
    const base = fw.shape(row);
    return {
        ...base,
        isOnline: !!onlineIDs[base.citizenid],
        sourceID: onlineIDs[base.citizenid] || null
    };
}

router.get('/api/players', async (req, res) => {
    // LIMIT/OFFSET are not reliably bindable: clamped integers, inlined
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 100);
    const search = req.query.search || '';
    const offset = (page - 1) * limit;

    try {
        // 1. Online list from the bridge (status dot)
        const bridge = await fetchOnlinePlayers();
        const onlineIDs = bridge.online;

        // 2. Query from the framework profile (ESX: users + flat name columns)
        const fw = await profile();
        let query;
        let params;

        if (search) {
            query = `
                SELECT ${fw.selectFields}
                FROM ${fw.table}
                WHERE ${fw.searchSql}
                LIMIT ${limit} OFFSET ${offset}
            `;
            const searchTerm = `%${search}%`;
            params = Array(fw.searchParams).fill(searchTerm);
        } else {
            query = `SELECT ${fw.selectFields} FROM ${fw.table} LIMIT ${limit} OFFSET ${offset}`;
            params = [];
        }

        const [rows] = await db.execute(query, params);
        const players = rows.map(row => shapePlayer(row, onlineIDs, fw));

        // Do the DB and the game server belong together?
        const dbMismatch = bridge.reachable ? await checkDatabaseMatchesServer(onlineIDs) : null;

        // Bridge state lets the frontend tell "offline" from "bridge not answering"
        res.json({
            players,
            bridge: {
                reachable: bridge.reachable,
                error: bridge.error || null,
                dbMismatch,
                onlineCount: Object.keys(onlineIDs).length
            }
        });

    } catch (error) {
        console.error('[Players] list failed:', error.message);
        res.status(500).json({ error: 'Database error' });
    }
});

// Single player: reload one record after a change
router.get('/api/players/:citizenid', async (req, res) => {
    try {
        const bridge = await fetchOnlinePlayers();
        const fw = await profile();
        const [rows] = await db.execute(
            `SELECT ${fw.selectFields} FROM ${fw.table} WHERE ${fw.idColumn} = ?`,
            [req.params.citizenid]
        );
        if (rows.length === 0) return res.status(404).json({ error: 'Player not found' });

        res.json(shapePlayer(rows[0], bridge.online, fw));
    } catch (error) {
        console.error('[Players] single lookup failed:', error.message);
        res.status(500).json({ error: 'Database error' });
    }
});

module.exports = { router, checkDatabaseMatchesServer };
