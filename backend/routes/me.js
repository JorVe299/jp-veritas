// Veritas ID (citizen portal): read-only, scoped to the signed-in Discord account
// SECURITY: no identity from the client; a URL citizenid only passes requireOwnership
const express = require('express');
const { db, parseJSON, tableExists } = require('../utils/dbHandler');
const { charactersOf, owns, identifiersOf } = require('../utils/identity');
const txadmin = require('../utils/txadmin');
const banlist = require('../utils/banlist');
const banLog = require('../utils/banLog');

const router = express.Router();

// Portal needs a Discord identity; with login disabled it cannot work, and says so
function requireIdentity(req, res, next) {
    if (!req.user?.id) {
        return res.status(401).json({
            error: 'Not signed in',
            hint: 'Veritas ID needs a Discord sign-in - it has no other way to know whose characters to show.',
        });
    }
    // Portal flag from the session (set at sign-in, kept current by the live role check)
    // SECURITY: '!== true', so the guard does not rely on publicUser() normalising the flag
    if (req.user.portal !== true) {
        return res.status(403).json({
            error: 'This account cannot use Veritas ID',
            hint: 'The portal is open to members of the Discord server who have a character here.',
        });
    }
    next();
}

// SECURITY: proves ownership of :citizenid before any handler runs
async function requireOwnership(req, res, next) {
    const { citizenid } = req.params;
    try {
        if (!await owns(req.user.id, citizenid)) {
            // SECURITY: same 404 as for a missing character; no lookup oracle for citizenids
            return res.status(404).json({ error: 'No such character on your account' });
        }
        next();
    } catch (e) {
        console.error('[Me] ownership check failed:', e.message);
        res.status(500).json({ error: 'Database error while checking the character' });
    }
}

router.use('/api/me', requireIdentity);

// --- Account and characters -----------------------------------------------
router.get('/api/me', async (req, res) => {
    try {
        const result = await charactersOf(req.user.id);

        if (result === null) {
            return res.status(400).json({ error: 'The Discord id on this session is malformed' });
        }
        if (result.unsupported) {
            return res.status(501).json({
                error: `Veritas ID does not support ${result.unsupported} yet`,
                hint: 'The portal reads the users/players split of the QBCore family. Other schemas key characters differently.',
            });
        }

        res.json({
            discordId: req.user.id,
            displayName: req.user.globalName || req.user.username,
            avatarUrl: req.user.avatarUrl || null,
            gameAccount: result.username,
            characters: result.characters,
            count: result.characters.length,
            // In the Discord but never played: nothing to show yet, not an error
            hint: result.characters.length === 0
                ? 'No character is linked to this Discord account yet. Join the server once and it will appear here.'
                : null,
        });
    } catch (e) {
        console.error('[Me] character list failed:', e.message);
        res.status(500).json({ error: 'Database error while loading your characters' });
    }
});

// --- Ban record -----------------------------------------------------------
// Account level: bans target identifiers and follow the person across characters
router.get('/api/me/bans', async (req, res) => {
    try {
        const identifiers = await identifiersOf(req.user.id);
        if (identifiers === null) {
            return res.status(400).json({ error: 'The Discord id on this session is malformed' });
        }

        // Both records, like the panel: txAdmin knowing nothing is not "nothing on file"
        const own = new Set(identifiers);

        const database = { available: false };
        let rows = [];
        try {
            const found = await banlist.databaseBansFor(identifiers);
            database.available = found.available;
            if (found.reason) database.reason = found.reason;
            rows = found.rows;
        } catch (e) {
            console.error('[Me] database bans failed:', e.message);
            database.reason = 'The ban table could not be read';
        }

        const tx = { available: false };
        let txRows = [];
        const fromTx = await txadmin.actionsFor(identifiers, { types: ['ban'] });
        if (fromTx.available) {
            tx.available = true;
            txRows = fromTx.actions
                .map(a => ({ ...a, identifiers: [] }))
                .map(banlist.fromTxAdmin);
        } else {
            tx.reason = fromTx.reason;
            tx.hint = fromTx.hint;
        }

        // Past panel bans whose row is gone; one still in the table is already listed above
        // History only adds what is over: a failed read hides no ban in force
        let pastRows = [];
        try {
            const entries = await banLog.withState(banLog.log.forPerson({ identifiers }));
            pastRows = entries.filter(e => e.state !== 'active').map(banLog.asMergedRow);
        } catch (e) {
            console.error('[Me] ban history failed:', e.message);
        }

        const merged = banlist
            .sortBans([...rows, ...txRows, ...pastRows])
            .filter(row => row.source !== banlist.DATABASE || banlist.belongsTo(row, own))
            .map(citizenView);

        // available: true only if every record was read; partial must never read as complete
        const complete = database.available && tx.available;
        const failed = !database.available ? database : tx;

        res.json({
            available: complete,
            reason: complete ? undefined : failed.reason,
            hint: complete ? undefined : failed.hint,

            bans: merged,
            count: merged.length,
            activeCount: merged.filter(b => b.active).length,

            // Per record: the page shows what it has and names what is missing
            sources: { database, txadmin: tx },
            showsAuthor: txadmin.SHOW_AUTHOR,
        });
    } catch (e) {
        console.error('[Me] ban history failed:', e.message);
        res.status(500).json({ error: 'Could not read the ban history' });
    }
});

// SECURITY: player view; never identifiers (database rows hold the IP), the filed name,
// other characters, or the issuing admin (unless TXADMIN_SHOW_BAN_AUTHOR)
function citizenView(row) {
    const out = {
        id: row.nativeId,
        type: row.type,
        reason: row.reason,
        issuedAt: row.issuedAt,
        issuedAtKnown: row.issuedAtKnown,
        expiresAt: row.expiresAt,
        permanent: row.permanent,
        revoked: row.revoked,
        revokedAt: row.revokedAt,
        expired: row.expired,
        active: row.active,
        // Staff-written vs server software: meaningful to the person affected
        source: row.source,
    };
    if (txadmin.SHOW_AUTHOR) out.issuedBy = row.issuedBy || null;
    return out;
}

// --- Character detail -----------------------------------------------------
router.get('/api/me/characters/:citizenid', requireOwnership, async (req, res) => {
    try {
        const [rows] = await db.execute(
            'SELECT citizenid, charinfo, job, gang, money, metadata, last_logged_out FROM players WHERE citizenid = ?',
            [req.params.citizenid]
        );
        if (rows.length === 0) return res.status(404).json({ error: 'No such character on your account' });

        const row = rows[0];
        const char = parseJSON(row.charinfo);
        const job = parseJSON(row.job);
        const gang = parseJSON(row.gang);
        const money = parseJSON(row.money);
        const meta = parseJSON(row.metadata);

        // SECURITY: licences only; raw metadata also holds moderation notes
        const licences = meta.licences || meta.licenses || {};

        res.json({
            citizenid: row.citizenid,
            name: `${char.firstname || '?'} ${char.lastname || ''}`.trim(),
            charinfo: {
                firstname: char.firstname || null,
                lastname: char.lastname || null,
                birthdate: char.birthdate || null,
                gender: char.gender ?? null,
                nationality: char.nationality || null,
                phone: char.phone || null,
            },
            job: {
                name: job.name || null,
                label: job.label || null,
                grade: job.grade?.name || null,
                gradeLevel: job.grade?.level ?? null,
                onduty: job.onduty ?? null,
            },
            gang: gang.name && gang.name !== 'none'
                ? { name: gang.name, label: gang.label, grade: gang.grade?.name || null }
                : null,
            money: { cash: Number(money.cash) || 0, bank: Number(money.bank) || 0 },
            licences: {
                driver: licences.driver === true,
                business: licences.business === true,
                weapon: licences.weapon === true,
                pilot: licences.pilot === true,
            },
            condition: {
                hunger: meta.hunger ?? null,
                thirst: meta.thirst ?? null,
                armor: meta.armor ?? null,
            },
            lastSeen: row.last_logged_out || null,
        });
    } catch (e) {
        console.error('[Me] character detail failed:', e.message);
        res.status(500).json({ error: 'Database error while loading the character' });
    }
});

// --- Character inventory --------------------------------------------------
router.get('/api/me/characters/:citizenid/inventory', requireOwnership, async (req, res) => {
    try {
        const [rows] = await db.execute(
            'SELECT inventory FROM players WHERE citizenid = ?', [req.params.citizenid]
        );
        if (rows.length === 0) return res.status(404).json({ error: 'No such character on your account' });

        const raw = parseJSON(rows[0].inventory);
        const list = Array.isArray(raw) ? raw : Object.values(raw || {}).filter(Boolean);

        const items = list
            .map(it => ({
                slot: it.slot ?? null,
                name: it.name,
                amount: it.count ?? it.amount ?? 0,
            }))
            .filter(it => it.name && it.amount > 0)
            .sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0));

        res.json({ items, count: items.length });
    } catch (e) {
        console.error('[Me] inventory failed:', e.message);
        res.status(500).json({ error: 'Database error while loading the inventory' });
    }
});

// --- Character vehicles ---------------------------------------------------
router.get('/api/me/characters/:citizenid/vehicles', requireOwnership, async (req, res) => {
    try {
        if (!await tableExists('player_vehicles')) {
            return res.json({ vehicles: [], count: 0, available: false });
        }

        const [rows] = await db.execute(
            'SELECT vehicle, plate, garage, state FROM player_vehicles WHERE citizenid = ? ORDER BY id DESC',
            [req.params.citizenid]
        );

        const STATE = { 0: 'Out', 1: 'In garage', 2: 'Impounded' };
        res.json({
            available: true,
            vehicles: rows.map(r => ({
                model: r.vehicle,
                plate: (r.plate || '').trim(),
                garage: r.garage ?? null,
                state: r.state ?? null,
                stateLabel: STATE[r.state] ?? 'Unknown',
            })),
            count: rows.length,
        });
    } catch (e) {
        console.error('[Me] vehicles failed:', e.message);
        res.status(500).json({ error: 'Database error while loading the vehicles' });
    }
});

module.exports = { router };
