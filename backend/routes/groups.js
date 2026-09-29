// Memberships in player_groups (citizenid, group, type, grade)
// Qbox: several groups per player; the job column holds only the active one
const express = require('express');
const { db, tableExists } = require('../utils/dbHandler');
const { getJobs, getGangs } = require('../utils/dataLoader');

const router = express.Router();
const TABLE = 'player_groups';

// Reserved word in MySQL: always backticked
const GROUP_COL = '`group`';

const TYPES = ['job', 'gang'];

async function ensureTable(res) {
    if (await tableExists(TABLE)) return true;
    res.status(501).json({
        error: `Table '${TABLE}' does not exist in this database`,
        hint: 'Group management is specific to Qbox. Older QBCore servers keep jobs and gangs in the players table only.'
    });
    return false;
}

function catalogFor(type) {
    return type === 'gang' ? getGangs() : getJobs();
}

// --- A player's memberships -----------------------------------------------
router.get('/api/players/:citizenid/groups', async (req, res) => {
    try {
        if (!await ensureTable(res)) return;

        const [rows] = await db.execute(
            `SELECT ${GROUP_COL} AS name, type, grade FROM ${TABLE} WHERE citizenid = ?`,
            [req.params.citizenid]
        );

        const groups = rows.map(row => {
            const meta = catalogFor(row.type)[row.name];
            const gradeMeta = meta?.grades?.[String(row.grade)];
            return {
                name: row.name,
                type: row.type,
                grade: Number(row.grade) || 0,
                label: meta?.label || row.name,
                gradeName: gradeMeta?.name || null,
                // Unknown to the catalog: leftover of a removed resource, flagged as such
                known: Boolean(meta)
            };
        });

        res.json({
            groups,
            count: groups.length,
            catalogs: {
                job: Object.keys(getJobs()).length,
                gang: Object.keys(getGangs()).length
            }
        });
    } catch (e) {
        console.error('[Groups] read failed:', e.message);
        res.status(500).json({ error: 'Database error while loading the groups' });
    }
});

// --- Add or change a membership -------------------------------------------
router.post('/api/manage/group', async (req, res) => {
    const { citizenid, group, type, grade } = req.body;

    if (!citizenid || !group) return res.status(400).json({ error: 'citizenid and group are required' });
    if (!TYPES.includes(type)) return res.status(400).json({ error: `type must be one of ${TYPES.join(', ')}` });

    const level = Number(grade ?? 0);
    if (!Number.isInteger(level) || level < 0 || level > 100) {
        return res.status(400).json({ error: 'grade must be a whole number between 0 and 100' });
    }

    // Validate against the catalog when one is loaded
    const catalog = catalogFor(type);
    if (Object.keys(catalog).length > 0) {
        const meta = catalog[group];
        if (!meta) return res.status(404).json({ error: `${type} '${group}' does not exist` });
        if (meta.grades && !meta.grades[String(level)]) {
            return res.status(400).json({ error: `Grade '${level}' does not exist for ${type} '${group}'` });
        }
    }

    try {
        if (!await ensureTable(res)) return;

        const [player] = await db.execute('SELECT citizenid FROM players WHERE citizenid = ?', [citizenid]);
        if (player.length === 0) return res.status(404).json({ error: 'Player not found' });

        // One row per player and group: update instead of a second insert
        const [existing] = await db.execute(
            `SELECT grade FROM ${TABLE} WHERE citizenid = ? AND ${GROUP_COL} = ?`,
            [citizenid, group]
        );

        if (existing.length > 0) {
            await db.execute(
                `UPDATE ${TABLE} SET grade = ?, type = ? WHERE citizenid = ? AND ${GROUP_COL} = ?`,
                [level, type, citizenid, group]
            );
        } else {
            await db.execute(
                `INSERT INTO ${TABLE} (citizenid, ${GROUP_COL}, type, grade) VALUES (?, ?, ?, ?)`,
                [citizenid, group, type, level]
            );
        }

        res.json({
            status: 'success',
            mode: 'offline',
            message: existing.length > 0
                ? `${group} set to grade ${level}`
                : `Added to ${group} at grade ${level}`,
            group: { name: group, type, grade: level },
            hint: 'Group changes are read when the player next loads their character.'
        });
    } catch (e) {
        console.error('[Groups] write failed:', e.message);
        res.status(500).json({ error: 'Database error while saving the group' });
    }
});

// --- Remove a membership --------------------------------------------------
router.delete('/api/manage/group', async (req, res) => {
    const { citizenid, group, type } = req.body;
    if (!citizenid || !group) return res.status(400).json({ error: 'citizenid and group are required' });
    // type required: names are unique per type only (a 'vagos' job and gang can coexist)
    if (!TYPES.includes(type)) return res.status(400).json({ error: `type must be one of ${TYPES.join(', ')}` });

    try {
        if (!await ensureTable(res)) return;

        const [result] = await db.execute(
            `DELETE FROM ${TABLE} WHERE citizenid = ? AND ${GROUP_COL} = ? AND type = ?`,
            [citizenid, group, type]
        );
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: `The player is not in that ${type}` });
        }

        res.json({ status: 'success', message: `Removed from ${group}` });
    } catch (e) {
        console.error('[Groups] delete failed:', e.message);
        res.status(500).json({ error: 'Database error while removing the group' });
    }
});

module.exports = { router };
