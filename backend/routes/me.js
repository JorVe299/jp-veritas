// backend/routes/me.js
// Veritas ID - the citizen portal.
//
// Everything here answers one question: what belongs to the person who is
// signed in? No route accepts an identity from the client. A citizenid in a
// URL is only ever used to pick one item out of a set that ownership has
// already established, and requireOwnership below is the only way in.
//
// Read-only on purpose. A player looking at their own bank balance is a
// different risk from a player changing it, and the second one is not what
// was asked for.
const express = require('express');
const { db, parseJSON, tableExists } = require('../utils/dbHandler');
const { charactersOf, owns, identifiersOf } = require('../utils/identity');
const txadmin = require('../utils/txadmin');
const banlist = require('../utils/banlist');

const router = express.Router();

// Every portal route needs a signed-in Discord account. When the panel runs
// without Discord login there is no identity at all, and the portal simply
// cannot work - saying that beats showing an empty page.
function requireIdentity(req, res, next) {
    if (!req.user?.id) {
        return res.status(401).json({
            error: 'Not signed in',
            hint: 'Veritas ID needs a Discord sign-in - it has no other way to know whose characters to show.',
        });
    }
    // Guild membership was checked at sign-in and recorded in the session;
    // re-checking here would mean a Discord call on every request.
    // '!== true' rather than '=== false': publicUser() happens to normalise
    // this to a boolean today, so both read the same - but a guard that only
    // holds because of what some other module does is one refactor away from
    // letting people through. Say what is required instead.
    // Told apart deliberately. Both are 403, but only one of them is
    // about the account - the other is about the cookie, and the person
    // can fix it in ten seconds once somebody says so.
    if (req.user.portalKnown === false) {
        return res.status(403).json({
            error: 'Your sign-in is older than Veritas ID',
            hint: 'Sign out and sign in again - the portal is decided when you sign in, and this session predates it.',
            stale: true,
        });
    }

    if (req.user.portal !== true) {
        return res.status(403).json({
            error: 'This account cannot use Veritas ID',
            hint: 'The portal is open to members of the Discord server who have a character here.',
        });
    }
    next();
}

// Pulls the citizenid out of the URL and proves it belongs to the caller
// before any handler sees it.
async function requireOwnership(req, res, next) {
    const { citizenid } = req.params;
    try {
        if (!await owns(req.user.id, citizenid)) {
            // Deliberately the same answer as for a character that does not
            // exist. Telling someone "that one exists but is not yours"
            // would turn the portal into a lookup service for citizenids.
            return res.status(404).json({ error: 'No such character on your account' });
        }
        next();
    } catch (e) {
        console.error('[Me] ownership check failed:', e.message);
        res.status(500).json({ error: 'Database error while checking the character' });
    }
}

router.use('/api/me', requireIdentity);

// --- Who am I and what do I have -----------------------------------------
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
            // Someone in the Discord who has never played lands here. That
            // is not an error, it just has nothing to show yet.
            hint: result.characters.length === 0
                ? 'No character is linked to this Discord account yet. Join the server once and it will appear here.'
                : null,
        });
    } catch (e) {
        console.error('[Me] character list failed:', e.message);
        res.status(500).json({ error: 'Database error while loading your characters' });
    }
});

// --- What txAdmin has on record ------------------------------------------
// Account level rather than character level, because that is how a txAdmin
// ban works: it is issued against identifiers and therefore follows the
// person across every character they have. Hanging it off one character
// would suggest the others are unaffected.
router.get('/api/me/bans', async (req, res) => {
    try {
        const identifiers = await identifiersOf(req.user.id);
        if (identifiers === null) {
            return res.status(400).json({ error: 'The Discord id on this session is malformed' });
        }

        // Both records, the same as the panel - a citizen banned through
        // this panel's own ban tool must not be told there is nothing on
        // file just because txAdmin has never heard of them.
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

        const merged = banlist
            .sortBans([...rows, ...txRows])
            .filter(row => row.source !== banlist.DATABASE || banlist.belongsTo(row, own))
            .map(citizenView);

        // 'available' stays true only when every record could be read. An
        // older page reads this field alone, and a partial list shown as a
        // complete one is the one answer this route must never give.
        const complete = database.available && tx.available;
        const failed = !database.available ? database : tx;

        res.json({
            available: complete,
            reason: complete ? undefined : failed.reason,
            hint: complete ? undefined : failed.hint,

            bans: merged,
            count: merged.length,
            activeCount: merged.filter(b => b.active).length,

            // Per record, so a page can show what it has and still say what
            // is missing instead of choosing between the two.
            sources: { database, txadmin: tx },
            showsAuthor: txadmin.SHOW_AUTHOR,
        });
    } catch (e) {
        console.error('[Me] ban history failed:', e.message);
        res.status(500).json({ error: 'Could not read the ban history' });
    }
});

// What a player is shown about a ban against them.
//
// Deliberately narrower than the staff view. Absent no matter what:
//   - identifiers, which on a database row include the IP the ban was
//     issued against
//   - the name the ban was filed under, and any other character on the
//     account
//   - the admin who issued it, unless the server owner turned that on
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
        // Which record holds it. Not plumbing to the person affected: it
        // is the difference between something this community's staff wrote
        // and something the server software did.
        source: row.source,
    };
    if (txadmin.SHOW_AUTHOR) out.issuedBy = row.issuedBy || null;
    return out;
}

// --- One character in full ------------------------------------------------
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

        // Only the parts of metadata a player has any business seeing about
        // themselves. The raw column also holds moderation notes.
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

// --- What that character is carrying -------------------------------------
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

// --- And what it drives ---------------------------------------------------
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
