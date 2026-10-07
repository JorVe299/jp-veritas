// Ban routes: merged list (both records), per-player bans, issue and lift (`bans` table only)
// Identifiers come from users/players, never typed in: a mistyped license bans nobody
const express = require('express');
const { db, tableExists, pickExistingColumns } = require('../utils/dbHandler');
const { isPlayerOnline, callBridge } = require('../utils/bridge');
const txadmin = require('../utils/txadmin');
const banlist = require('../utils/banlist');
const { identifiersForCitizen, citizensByIdentifier } = require('../utils/identity');
const banLog = require('../utils/banLog');

const router = express.Router();
const TABLE = 'bans';

// Shared with the portal (utils/banlist.js): one definition of "permanent"
const { shapeBan } = banlist;

async function ensureTable(res) {
    if (await tableExists(TABLE)) return true;
    res.status(501).json({
        error: `Table '${TABLE}' does not exist in this database`,
        hint: 'Ban management expects the standard QBCore/Qbox schema.'
    });
    return false;
}

// Written into the history; no req.user = login disabled, nobody to name
function staffName(req) {
    return req.user?.globalName || req.user?.username || 'Veritas Panel';
}

// players.userId -> users, where license and discord live
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

// --- Both records, one list -----------------------------------------------
// Rows keep their source: only database bans can be lifted here
// Citizen filter = exact identifier match (no record stores a citizenid)
const MERGE_CEILING = 2000;

router.get('/api/bans/all', async (req, res) => {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const rawQuery = String(req.query.q || '').trim();
    const needle = rawQuery.toLowerCase();
    const citizenid = String(req.query.citizenid || '').trim();
    const activeOnly = req.query.active === 'true';
    const wantWarnings = req.query.include === 'warnings';
    const onlySource = ['database', 'txadmin', 'history'].includes(req.query.source) ? req.query.source : null;

    try {
        // Citizen filter: resolve to identifiers
        let identifierSet = null;
        let identity = null;
        if (citizenid) {
            const owned = await identifiersForCitizen(citizenid);
            identifierSet = new Set(owned);
            identity = { citizenid, identifiers: owned.length };
        }

        // Database record
        const database = { available: false, count: 0 };
        let rows = [];
        if (!onlySource || onlySource === 'database') {
            if (await tableExists(TABLE)) {
                const [raw] = await db.execute(
                    `SELECT * FROM ${TABLE} ORDER BY id DESC LIMIT ${MERGE_CEILING}`
                );
                rows = raw.map(shapeBan).map(banlist.fromDatabase);
                database.available = true;
                database.count = rows.length;
            } else {
                database.reason = `Table '${TABLE}' does not exist in this database`;
            }
        }

        // txAdmin record; availability reported separately, never silently dropped from the list
        const txState = { available: false, count: 0 };
        let txRows = [];
        if (!onlySource || onlySource === 'txadmin') {
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

        // Panel history: only what is over; an entry whose row still exists is listed above
        const history = { available: false, count: 0 };
        let pastRows = [];
        if (!onlySource || onlySource === 'history') {
            try {
                const entries = await banLog.withState(banLog.log.all());
                pastRows = entries.filter(e => e.state !== 'active').map(banLog.asMergedRow);
                history.available = true;
                history.count = pastRows.length;
            } catch (e) {
                history.reason = e.message;
            }
        }

        // Merge and filter
        let merged = [...rows, ...txRows, ...pastRows];
        if (identifierSet) merged = merged.filter(r => banlist.belongsTo(r, identifierSet));
        if (activeOnly) merged = merged.filter(r => r.active);

        // A citizenid-shaped search term matches that person's identifiers
        // (row citizenids are only resolved later, for the page being sent)
        let searchIdentifiers = null;
        if (needle && /^[A-Za-z0-9_-]{3,32}$/.test(rawQuery)) {
            try {
                const owned = await identifiersForCitizen(rawQuery);
                if (owned.length > 0) searchIdentifiers = new Set(owned);
            } catch (e) {
                // Lookup failure: plain text search only
                console.warn('[Bans] citizen lookup for search term failed:', e.message);
            }
        }

        if (needle) {
            merged = merged.filter(r =>
                banlist.matchesQuery(r, needle)
                || (searchIdentifiers && banlist.belongsTo(r, searchIdentifiers))
            );
        }

        merged = banlist.sortBans(merged);

        const count = merged.length;
        const activeCount = merged.filter(r => r.active).length;
        const slice = merged.slice((page - 1) * limit, page * limit);

        // Owners for the sent page only, in one query
        const owners = await citizensByIdentifier(slice.flatMap(r => r.identifiers));
        for (const row of slice) {
            const found = [];
            for (const identifier of row.identifiers) {
                for (const entry of owners.get(identifier) || []) {
                    if (!found.some(e => e.citizenid === entry.citizenid)) found.push(entry);
                }
            }
            row.characters = found;
            // citizenid only when exactly one character matches; the list carries all of them
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
            sources: { database, txadmin: txState, history },
            filter: {
                citizenid: citizenid || null,
                q: rawQuery || null,
                // Search term resolved to a person, not free text
                qMatchedCitizen: Boolean(searchIdentifiers),
                active: activeOnly,
                include: wantWarnings ? 'warnings' : 'bans',
                source: onlySource,
            },
            identity,
            // No created-at column: undated rows sort by id after the dated ones
            sort: 'In force first, then newest. The bans table records no date; those rows follow the dated ones.',
        });
    } catch (e) {
        console.error('[Bans] merged list failed:', e.message);
        res.status(500).json({ error: 'The ban list could not be assembled' });
    }
});

// --- A player's bans ------------------------------------------------------
router.get('/api/players/:citizenid/bans', async (req, res) => {
    try {
        if (!await ensureTable(res)) return;

        const who = await identityFor(req.params.citizenid);
        if (!who) return res.status(404).json({ error: 'Player not found' });

        // No identifiers: no ban can match; empty list, not an error
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

        const expire = banlist.expiryFor(duration);

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

        // Kick if online, else the ban only bites on the next connect
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

        // The ban stands either way; a refused history write is reported, not rolled back
        let history = { logged: true };
        try {
            banLog.log.recordIssued(
                shapeBan({ id: result.insertId, ...payload }),
                { citizenid, by: staffName(req) }
            );
        } catch (e) {
            console.error('[Bans] history write failed:', e.message);
            history = { logged: false, error: e.message, hint: e.hint };
        }

        res.json({
            status: 'success',
            message: duration === 0
                ? `${who.name} banned permanently`
                : `${who.name} banned for ${duration} day(s)`,
            ban: { id: result.insertId, expire, permanent: duration === 0 },
            kicked,
            history,
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

        // Read before the delete: the history keeps what the row said
        const [found] = await db.execute(`SELECT * FROM ${TABLE} WHERE id = ?`, [id]);
        if (found.length === 0) return res.status(404).json({ error: 'Ban not found' });

        const [result] = await db.execute(`DELETE FROM ${TABLE} WHERE id = ?`, [id]);
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Ban not found' });

        let history = { logged: true };
        try {
            banLog.log.recordLifted(shapeBan(found[0]), { by: staffName(req) });
        } catch (e) {
            console.error('[Bans] history write failed:', e.message);
            history = { logged: false, error: e.message, hint: e.hint };
        }

        console.log(`[Bans] ban ${id} lifted by ${staffName(req)}`);
        res.json({ status: 'success', message: 'Ban lifted', history });
    } catch (e) {
        console.error('[Bans] delete failed:', e.message);
        res.status(500).json({ error: 'Database error while lifting the ban' });
    }
});

// --- History --------------------------------------------------------------
// Panel bans outlive their `bans` row here until someone with banlog.delete removes them

router.get('/api/players/:citizenid/ban-history', async (req, res) => {
    try {
        const who = await identityFor(req.params.citizenid);
        if (!who) return res.status(404).json({ error: 'Player not found' });

        const identifiers = banlist.identifiersFromRow({ license: who.license, discord: who.discord });
        const entries = await banLog.withState(
            banLog.log.forPerson({ citizenid: who.citizenid, identifiers })
        );
        res.json({ entries, count: entries.length });
    } catch (e) {
        console.error('[Bans] history read failed:', e.message);
        res.status(e.status || 500).json({ error: e.status ? e.message : 'The ban history could not be read' });
    }
});

router.delete('/api/manage/ban-history/:id', (req, res) => {
    try {
        if (!banLog.log.remove(String(req.params.id))) {
            return res.status(404).json({ error: 'History entry not found' });
        }
        console.log(`[Bans] history entry ${req.params.id} deleted by ${staffName(req)}`);
        res.json({ status: 'success', message: 'History entry deleted' });
    } catch (e) {
        res.status(e.status || 500).json({ error: e.message, hint: e.hint });
    }
});

module.exports = { router };
