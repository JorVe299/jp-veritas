// backend/routes/accounts.js
// Bank accounts from bank_accounts_new (id, amount, transactions, auth,
// isFrozen, creator).
//
// The id is not a counter but the account's identifier: for personal
// accounts the citizenid, for company accounts the job name. 'auth' is a
// JSON list of the citizenids allowed to use it.
const express = require('express');
const { db, parseJSON, tableExists } = require('../utils/dbHandler');
const { getJobs } = require('../utils/dataLoader');

const router = express.Router();
const TABLE = 'bank_accounts_new';

async function ensureTable(res) {
    if (await tableExists(TABLE)) return true;
    res.status(501).json({
        error: `Table '${TABLE}' does not exist in this database`,
        hint: 'Bank account management expects the qbx_banking schema.'
    });
    return false;
}

// Personal accounts carry a citizenid as their id, company accounts a job
// name. The job catalog alone is not enough to tell them apart: if it were
// not loaded yet, every company account would look like a private one - and
// emptying a company account by accident is a different matter entirely.
const CITIZENID = /^[A-Z0-9]{6,12}$/;

function accountKind(id, job) {
    if (job) return 'business';
    return CITIZENID.test(String(id)) ? 'personal' : 'business';
}

function shapeAccount(row, jobs) {
    const auth = parseJSON(row.auth);
    const authList = Array.isArray(auth) ? auth : [];
    const job = jobs[row.id];

    return {
        id: row.id,
        kind: accountKind(row.id, job),
        label: job?.label || row.id,
        amount: Number(row.amount) || 0,
        frozen: row.isFrozen === 1 || row.isFrozen === true,
        creator: row.creator || null,
        authorized: authList,
        authorizedCount: authList.length
    };
}

// --- Every account --------------------------------------------------------
router.get('/api/accounts', async (req, res) => {
    const search = String(req.query.search || '').trim();
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 200);

    try {
        if (!await ensureTable(res)) return;

        let rows;
        if (search) {
            [rows] = await db.execute(
                `SELECT * FROM ${TABLE} WHERE id LIKE ? ORDER BY amount DESC LIMIT ${limit}`,
                [`%${search}%`]
            );
        } else {
            [rows] = await db.execute(`SELECT * FROM ${TABLE} ORDER BY amount DESC LIMIT ${limit}`);
        }

        const jobs = getJobs();
        const accounts = rows.map(r => shapeAccount(r, jobs));
        res.json({
            accounts,
            count: accounts.length,
            totalHeld: accounts.reduce((sum, a) => sum + a.amount, 0)
        });
    } catch (e) {
        console.error('[Accounts] list failed:', e.message);
        res.status(500).json({ error: 'Database error while loading the accounts' });
    }
});

// --- A player's accounts --------------------------------------------------
// Their own account plus every account they are authorised on.
router.get('/api/players/:citizenid/accounts', async (req, res) => {
    const citizenid = req.params.citizenid;

    try {
        if (!await ensureTable(res)) return;

        // A LIKE on the JSON column finds candidates; the real check is the
        // filter below, otherwise a citizenid that is a substring of another
        // one would match by mistake.
        const [rows] = await db.execute(
            `SELECT * FROM ${TABLE} WHERE id = ? OR auth LIKE ?`,
            [citizenid, `%${citizenid}%`]
        );

        const jobs = getJobs();
        const accounts = rows
            .map(r => shapeAccount(r, jobs))
            .filter(a => a.id === citizenid || a.authorized.includes(citizenid));

        res.json({ accounts, count: accounts.length });
    } catch (e) {
        console.error('[Accounts] player lookup failed:', e.message);
        res.status(500).json({ error: 'Database error while loading the accounts' });
    }
});

// --- Change the balance ---------------------------------------------------
router.post('/api/manage/account', async (req, res) => {
    const { id, amount, mode } = req.body;

    if (!id) return res.status(400).json({ error: 'id is required' });

    const value = Number(amount);
    if (!Number.isFinite(value)) return res.status(400).json({ error: 'amount must be a number' });
    if (!['delta', 'set'].includes(mode)) {
        return res.status(400).json({ error: "mode must be 'delta' or 'set'" });
    }
    if (mode === 'set' && value < 0) {
        return res.status(400).json({ error: 'A balance cannot be set below zero' });
    }

    try {
        if (!await ensureTable(res)) return;

        const [rows] = await db.execute(`SELECT * FROM ${TABLE} WHERE id = ?`, [id]);
        if (rows.length === 0) return res.status(404).json({ error: 'Account not found' });

        const current = Number(rows[0].amount) || 0;
        const next = mode === 'set' ? value : current + value;

        if (next < 0) {
            return res.status(409).json({
                error: `That would leave the account at ${next}`,
                hint: `The account currently holds ${current}.`
            });
        }

        await db.execute(`UPDATE ${TABLE} SET amount = ? WHERE id = ?`, [next, id]);

        const jobs = getJobs();
        const account = shapeAccount({ ...rows[0], amount: next }, jobs);
        console.log(`[Accounts] ${id}: ${current} -> ${next}`);

        res.json({
            status: 'success',
            mode: 'offline',
            message: `${account.label} now holds ${next}`,
            previous: current,
            account,
            hint: 'A player with this account open in game sees the new balance after reopening it.'
        });
    } catch (e) {
        console.error('[Accounts] update failed:', e.message);
        res.status(500).json({ error: 'Database error while updating the account' });
    }
});

// --- Freeze and unfreeze an account ---------------------------------------
router.post('/api/manage/account/freeze', async (req, res) => {
    const { id, frozen } = req.body;

    if (!id) return res.status(400).json({ error: 'id is required' });
    if (typeof frozen !== 'boolean') return res.status(400).json({ error: 'frozen must be true or false' });

    try {
        if (!await ensureTable(res)) return;

        const [result] = await db.execute(
            `UPDATE ${TABLE} SET isFrozen = ? WHERE id = ?`,
            [frozen ? 1 : 0, id]
        );
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Account not found' });

        res.json({
            status: 'success',
            message: frozen ? `Account ${id} frozen` : `Account ${id} unfrozen`
        });
    } catch (e) {
        console.error('[Accounts] freeze failed:', e.message);
        res.status(500).json({ error: 'Database error while changing the account' });
    }
});

module.exports = { router };
