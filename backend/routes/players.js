// backend/routes/players.js
// Player list and single lookup.
const express = require('express');
const { db } = require('../utils/dbHandler');
const { fetchOnlinePlayers } = require('../utils/bridge');
const { profile } = require('../utils/framework');

const router = express.Router();

// Checks whether the players the bridge reports as online exist in our
// database at all. If they do not, panel and game server are reading from
// different databases - and the panel then shows "offline" forever without
// an error appearing anywhere.
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

// Shapes a database row into the form the frontend expects. What a row
// looks like depends on the framework, so the profile does that part and
// only the online state is added here.
function shapePlayer(row, onlineIDs, fw) {
    const base = fw.shape(row);
    return {
        ...base,
        isOnline: !!onlineIDs[base.citizenid],
        sourceID: onlineIDs[base.citizenid] || null
    };
}

router.get('/api/players', async (req, res) => {
    // Forced to integers and clamped: LIMIT/OFFSET cannot be passed
    // reliably as prepared-statement parameters, so they are validated
    // here and inserted directly
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 100);
    const search = req.query.search || '';
    const offset = (page - 1) * limit;

    try {
        // 1. Fetch the online list from the bridge (for the status dot)
        const bridge = await fetchOnlinePlayers();
        const onlineIDs = bridge.online;

        // 2. Build the SQL query. Table, columns and the search itself
        // come from the framework profile - on ESX this reads `users` and
        // flat name columns instead of `players` and a charinfo JSON.
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

        // Sanity check: do the database and the game server belong together?
        const dbMismatch = bridge.reachable ? await checkDatabaseMatchesServer(onlineIDs) : null;

        // Send the bridge state along so the frontend can tell "offline"
        // from "the bridge is not answering"
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

// A single player - useful for reloading one record after a change
// instead of the whole list
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
