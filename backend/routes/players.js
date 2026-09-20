// backend/routes/players.js
// Spielerliste und Einzelabruf.
const express = require('express');
const { db, parseJSON } = require('../utils/dbHandler');
const { fetchOnlinePlayers } = require('../utils/bridge');

const router = express.Router();

const SELECT_FIELDS = 'citizenid, charinfo, job, money';

// Prüft, ob die von der Bridge gemeldeten Online-Spieler in unserer DB
// überhaupt existieren. Tun sie das nicht, lesen Panel und Gameserver
// aus verschiedenen Datenbanken - dann steht im Panel dauerhaft "offline",
// ohne dass irgendwo ein Fehler auftaucht.
async function checkDatabaseMatchesServer(onlineIDs) {
    const ids = Object.keys(onlineIDs);
    if (ids.length === 0) return null; // niemand online -> nichts zu prüfen

    const placeholders = ids.map(() => '?').join(',');
    const [found] = await db.execute(
        `SELECT citizenid FROM players WHERE citizenid IN (${placeholders})`,
        ids
    );

    if (found.length > 0) return null; // passt

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

// Eine DB-Zeile in die Form bringen, die das Frontend erwartet
function shapePlayer(row, onlineIDs) {
    const char = parseJSON(row.charinfo);
    const job = parseJSON(row.job);
    const money = parseJSON(row.money);

    return {
        citizenid: row.citizenid,
        name: `${char.firstname || '?'} ${char.lastname || ''}`.trim(),
        charinfo: char,
        job: job,
        jobLabel: `${job.label || 'No job'} - ${job.grade?.name || '-'}`,
        money: money, // { cash: x, bank: y }
        isOnline: !!onlineIDs[row.citizenid],
        sourceID: onlineIDs[row.citizenid] || null
    };
}

router.get('/api/players', async (req, res) => {
    // Auf Integer zwingen und begrenzen: LIMIT/OFFSET lassen sich nicht
    // zuverlässig als Prepared-Statement-Parameter übergeben, deshalb
    // werden sie hier validiert und direkt eingesetzt
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 100);
    const search = req.query.search || '';
    const offset = (page - 1) * limit;

    try {
        // 1. Hole Online-Liste von der Bridge (für den Status-Indikator)
        const bridge = await fetchOnlinePlayers();
        const onlineIDs = bridge.online;

        // 2. SQL Query bauen (Qbox speichert Namen in charinfo JSON)
        let query;
        let params;

        if (search) {
            // Wir suchen in Vorname, Nachname oder CitizenID
            query = `
                SELECT ${SELECT_FIELDS}
                FROM players
                WHERE
                    citizenid LIKE ? OR
                    JSON_UNQUOTE(JSON_EXTRACT(charinfo, '$.firstname')) LIKE ? OR
                    JSON_UNQUOTE(JSON_EXTRACT(charinfo, '$.lastname')) LIKE ?
                LIMIT ${limit} OFFSET ${offset}
            `;
            const searchTerm = `%${search}%`;
            params = [searchTerm, searchTerm, searchTerm];
        } else {
            query = `SELECT ${SELECT_FIELDS} FROM players LIMIT ${limit} OFFSET ${offset}`;
            params = [];
        }

        const [rows] = await db.execute(query, params);
        const players = rows.map(row => shapePlayer(row, onlineIDs));

        // Plausibilitätscheck: passen DB und Gameserver zusammen?
        const dbMismatch = bridge.reachable ? await checkDatabaseMatchesServer(onlineIDs) : null;

        // bridge mitliefern, damit das Frontend "offline" von
        // "Bridge antwortet nicht" unterscheiden kann
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
        console.error('[Players] Liste fehlgeschlagen:', error.message);
        res.status(500).json({ error: 'Database error' });
    }
});

// Einzelner Spieler - praktisch, um nach einer Änderung nur einen Datensatz
// nachzuladen statt die ganze Liste
router.get('/api/players/:citizenid', async (req, res) => {
    try {
        const bridge = await fetchOnlinePlayers();
        const [rows] = await db.execute(
            `SELECT ${SELECT_FIELDS} FROM players WHERE citizenid = ?`,
            [req.params.citizenid]
        );
        if (rows.length === 0) return res.status(404).json({ error: 'Player not found' });

        res.json(shapePlayer(rows[0], bridge.online));
    } catch (error) {
        console.error('[Players] Einzelabruf fehlgeschlagen:', error.message);
        res.status(500).json({ error: 'Database error' });
    }
});

module.exports = { router, checkDatabaseMatchesServer };
