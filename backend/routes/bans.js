// backend/routes/bans.js
// Ban management on the bans table of Qbox/QBCore.
//
// A ban does not hit the character but the identifiers behind it: license,
// discord and ip. That is why we read them from users/players instead of
// having them typed in - a mistyped license id bans nobody.
const express = require('express');
const { db, tableExists, pickExistingColumns } = require('../utils/dbHandler');
const { isPlayerOnline, callBridge } = require('../utils/bridge');
const txadmin = require('../utils/txadmin');
const banlist = require('../utils/banlist');
const { identifiersForCitizen, citizensByIdentifier } = require('../utils/identity');

const router = express.Router();
const TABLE = 'bans';

// QBCore stores the expiry as unix seconds. A 0, or a value far in the
// future, means "permanent" in practice.
const PERMANENT_AFTER_YEARS = 50;

function shapeBan(row) {
    const expire = Number(row.expire) || 0;
    const permanent = expire === 0 || expire > Date.now() / 1000 + PERMANENT_AFTER_YEARS * 31536000;
    return {
        id: row.id,
        name: row.name,
        license: row.license,
        discord: row.discord,
        ip: row.ip,
        reason: row.reason,
        bannedBy: row.bannedby,
        expire,
        expiresAt: expire > 0 ? new Date(expire * 1000).toISOString() : null,
        permanent,
        active: permanent || expire > Date.now() / 1000
    };
}

async function ensureTable(res) {
    if (await tableExists(TABLE)) return true;
    res.status(501).json({
        error: `Table '${TABLE}' does not exist in this database`,
        hint: 'Ban management expects the standard QBCore/Qbox schema.'
    });
    return false;
}

// Collect a player's identifiers. players.userId points at users, which is
// where license and discord live.
async function identityFor(citizenid) {
    const [rows] = await db.execute(
        `SELECT p.citizenid, p.name, p.license AS playerLicense,
                u.license AS userLicense, u.discord, u.username
         FROM players p
         LEFT JOIN users u ON u.userId = p.userId
         WHERE p.citizenid = ?`,
        [citizenid]
    );
    if (rows.length === 0) return null;

    const r = rows[0];
    return {
        citizenid: r.citizenid,
        name: r.name || r.username || citizenid,
        license: r.userLicense || r.playerLicense || null,
        discord: r.discord || null
    };
}

// --- Every ban ------------------------------------------------------------
// --- Both records, one list -----------------------------------------------
// The two ban records answer the same question and nobody asking it cares
// which file the answer came out of. So they are merged - but every row
// keeps its source, because only the database rows can be lifted from
// this panel, and an admin who mixes the two goes looking for a button
// that is not there.
//
// Neither record stores a citizenid. Filtering "by citizen" therefore
// resolves that person to their identifiers first and matches on those;
// a near miss on an identifier is not a weaker match, it is a different
// person, so the comparison is exact.
const MERGE_CEILING = 2000;

router.get('/api/bans/all', async (req, res) => {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const needle = String(req.query.q || '').trim().toLowerCase();
    const citizenid = String(req.query.citizenid || '').trim();
    const activeOnly = req.query.active === 'true';
    const wantWarnings = req.query.include === 'warnings';
    const onlySource = ['database', 'txadmin'].includes(req.query.source) ? req.query.source : null;

    try {
        // --- Who, if the question is about one person -------------------
        let identifierSet = null;
        let identity = null;
        if (citizenid) {
            const owned = await identifiersForCitizen(citizenid);
            identifierSet = new Set(owned);
            identity = { citizenid, identifiers: owned.length };
        }

        // --- The database half ------------------------------------------
        const database = { available: false, count: 0 };
        let rows = [];
        if (onlySource !== 'txadmin' && await tableExists(TABLE)) {
            const [raw] = await db.execute(
                `SELECT * FROM ${TABLE} ORDER BY id DESC LIMIT ${MERGE_CEILING}`
            );
            rows = raw.map(shapeBan).map(banlist.fromDatabase);
            database.available = true;
            database.count = rows.length;
        } else if (onlySource !== 'txadmin') {
            database.reason = `Table '${TABLE}' does not exist in this database`;
        }

        // --- The txAdmin half -------------------------------------------
        // Its availability is reported separately and never folded into
        // the list. A merged list that quietly drops half its sources is
        // the exact failure this whole feature exists to undo.
        const txState = { available: false, count: 0 };
        let txRows = [];
        if (onlySource !== 'database') {
            const result = await txadmin.allActions({
                types: wantWarnings ? ['ban', 'warn'] : ['ban'],
                limit: MERGE_CEILING,
            });
            if (result.available) {
                txRows = result.actions.map(banlist.fromTxAdmin);
                txState.available = true;
                txState.count = txRows.length;
                txState.truncated = result.truncated === true;
            } else {
                txState.reason = result.reason;
                txState.hint = result.hint;
            }
        }

        // --- One list ----------------------------------------------------
        let merged = [...rows, ...txRows];
        if (identifierSet) merged = merged.filter(r => banlist.belongsTo(r, identifierSet));
        if (activeOnly) merged = merged.filter(r => r.active);
        if (needle) merged = merged.filter(r => banlist.matchesQuery(r, needle));

        merged = banlist.sortBans(merged);

        const count = merged.length;
        const activeCount = merged.filter(r => r.active).length;
        const slice = merged.slice((page - 1) * limit, page * limit);

        // --- Put a face on the page --------------------------------------
        // Only for the rows actually being sent, and in one query.
        const owners = await citizensByIdentifier(slice.flatMap(r => r.identifiers));
        for (const row of slice) {
            const found = [];
            for (const identifier of row.identifiers) {
                for (const entry of owners.get(identifier) || []) {
                    if (!found.some(e => e.citizenid === entry.citizenid)) found.push(entry);
                }
            }
            row.characters = found;
            // A ban belongs to an account, and an account can hold several
            // characters. One citizenid is only stated where there is
            // exactly one; otherwise the list says how many there are.
            row.citizenid = found.length === 1 ? found[0].citizenid : null;
            if (!row.name && found.length > 0) row.name = found[0].name;
        }

        res.json({
            bans: slice,
            count,
            activeCount,
            page,
            limit,
            pages: Math.max(Math.ceil(count / limit), 1),
            sources: { database, txadmin: txState },
            filter: {
                citizenid: citizenid || null,
                q: needle || null,
                active: activeOnly,
                include: wantWarnings ? 'warnings' : 'bans',
                source: onlySource,
            },
            identity,
            // Said plainly rather than left to be noticed: the table has no
            // created-at column, so those rows cannot take part in a sort
            // by date and are ordered by id among themselves.
            sort: 'In force first, then newest. The bans table records no date; those rows follow the dated ones.',
        });
    } catch (e) {
        console.error('[Bans] merged list failed:', e.message);
        res.status(500).json({ error: 'The ban list could not be assembled' });
    }
});

// --- The other ban list ---------------------------------------------------
// A server bans in two places that know nothing about each other: this
// table, which the framework and this panel write, and txAdmin's own
// record, which is a JSON file beside the server. A page called "Bans"
// that shows only the first is not wrong so much as incomplete, and the
// gap is invisible - an empty table reads as "nobody is banned" even
// while txAdmin is turning people away at the door.
//
// Read-only, and it stays that way: txAdmin owns that file, and two
// processes writing it is how a ban list gets truncated.
router.get('/api/bans/txadmin', async (req, res) => {
    try {
        const result = await txadmin.allActions({
            types: req.query.include === 'warnings' ? ['ban', 'warn'] : ['ban'],
            query: req.query.q,
            activeOnly: req.query.active === 'true',
            limit: req.query.limit,
        });

        if (!result.available) {
            // Not an error: plenty of servers do not run txAdmin. But it is
            // not an empty list either, and the two must not look alike.
            return res.json({
                available: false,
                reason: result.reason,
                hint: result.hint,
                bans: [],
                count: 0,
                activeCount: 0,
            });
        }

        res.json({
            available: true,
            bans: result.actions,
            count: result.count,
            activeCount: result.activeCount,
            truncated: result.truncated,
            limit: result.limit,
            source: result.path,
            readOnly: true,
        });
    } catch (e) {
        console.error('[Bans] txAdmin list failed:', e.message);
        res.status(500).json({ error: 'The txAdmin ban record could not be read' });
    }
});

router.get('/api/bans', async (req, res) => {
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 25, 1), 100);
    const offset = (page - 1) * limit;
    const search = String(req.query.search || '').trim();

    try {
        if (!await ensureTable(res)) return;

        let rows;
        if (search) {
            const term = `%${search}%`;
            [rows] = await db.execute(
                `SELECT * FROM ${TABLE}
                 WHERE name LIKE ? OR license LIKE ? OR discord LIKE ? OR reason LIKE ?
                 ORDER BY id DESC LIMIT ${limit} OFFSET ${offset}`,
                [term, term, term, term]
            );
        } else {
            [rows] = await db.execute(
                `SELECT * FROM ${TABLE} ORDER BY id DESC LIMIT ${limit} OFFSET ${offset}`
            );
        }

        const bans = rows.map(shapeBan);
        res.json({ bans, count: bans.length, page });
    } catch (e) {
        console.error('[Bans] list failed:', e.message);
        res.status(500).json({ error: 'Database error while loading the bans' });
    }
});

// --- A player's bans ------------------------------------------------------
router.get('/api/players/:citizenid/bans', async (req, res) => {
    try {
        if (!await ensureTable(res)) return;

        const who = await identityFor(req.params.citizenid);
        if (!who) return res.status(404).json({ error: 'Player not found' });

        // Without identifiers there can be no matching ban either - then an
        // empty list is the right answer, not an error.
        const keys = [who.license, who.discord].filter(Boolean);
        if (keys.length === 0) {
            return res.json({ bans: [], identity: who, count: 0 });
        }

        const conditions = [];
        const params = [];
        if (who.license) { conditions.push('license = ?'); params.push(who.license); }
        if (who.discord) { conditions.push('discord = ?'); params.push(who.discord); }

        const [rows] = await db.execute(
            `SELECT * FROM ${TABLE} WHERE ${conditions.join(' OR ')} ORDER BY id DESC`,
            params
        );

        const bans = rows.map(shapeBan);
        res.json({ bans, identity: who, count: bans.length, active: bans.some(b => b.active) });
    } catch (e) {
        console.error('[Bans] player lookup failed:', e.message);
        res.status(500).json({ error: 'Database error while loading the bans' });
    }
});

// --- Issue a ban ----------------------------------------------------------
router.post('/api/manage/ban', async (req, res) => {
    const { citizenid, reason, days, bannedBy } = req.body;

    if (!citizenid) return res.status(400).json({ error: 'citizenid is required' });

    const text = String(reason || '').trim();
    if (text.length < 3 || text.length > 255) {
        return res.status(400).json({ error: 'reason must be 3-255 characters' });
    }

    // days omitted or 0 => permanent
    const duration = days == null || days === '' ? 0 : Number(days);
    if (!Number.isFinite(duration) || duration < 0 || duration > 3650) {
        return res.status(400).json({ error: 'days must be between 0 (permanent) and 3650' });
    }

    try {
        if (!await ensureTable(res)) return;

        const who = await identityFor(citizenid);
        if (!who) return res.status(404).json({ error: 'Player not found' });
        if (!who.license && !who.discord) {
            return res.status(409).json({
                error: 'This character has no license or Discord id on record',
                hint: 'A ban needs at least one identifier to match against - the player has to have joined at least once.'
            });
        }

        const expire = duration === 0
            ? Math.floor(Date.now() / 1000) + PERMANENT_AFTER_YEARS * 31536000
            : Math.floor(Date.now() / 1000 + duration * 86400);

        const payload = await pickExistingColumns(TABLE, {
            name: who.name,
            license: who.license || '',
            discord: who.discord || '',
            ip: '',
            reason: text,
            expire,
            bannedby: String(bannedBy || 'Veritas Panel').slice(0, 64)
        });

        const cols = Object.keys(payload);
        const [result] = await db.execute(
            `INSERT INTO ${TABLE} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`,
            Object.values(payload)
        );

        // Someone being banned while they are playing belongs off the
        // server - otherwise the ban only bites on their next attempt to
        // connect.
        let kicked = false;
        if (await isPlayerOnline(citizenid)) {
            try {
                await callBridge('/kick-player', { citizenid, reason: `Banned: ${text}` });
                kicked = true;
            } catch (e) {
                console.warn('[Bans] ban written but kick failed:', e.message);
            }
        }

        console.log(`[Bans] ${who.name} (${citizenid}) banned by ${payload.bannedby} - ${text}`);

        res.json({
            status: 'success',
            message: duration === 0
                ? `${who.name} banned permanently`
                : `${who.name} banned for ${duration} day(s)`,
            ban: { id: result.insertId, expire, permanent: duration === 0 },
            kicked,
            hint: kicked ? null : undefined
        });
    } catch (e) {
        console.error('[Bans] create failed:', e.message);
        res.status(500).json({ error: 'Database error while creating the ban' });
    }
});

// --- Lift a ban -----------------------------------------------------------
router.delete('/api/manage/ban/:id', async (req, res) => {
    const id = parseInt(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid ban ID' });

    try {
        if (!await ensureTable(res)) return;

        const [result] = await db.execute(`DELETE FROM ${TABLE} WHERE id = ?`, [id]);
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Ban not found' });

        console.log(`[Bans] ban ${id} lifted`);
        res.json({ status: 'success', message: 'Ban lifted' });
    } catch (e) {
        console.error('[Bans] delete failed:', e.message);
        res.status(500).json({ error: 'Database error while lifting the ban' });
    }
});

module.exports = { router };
