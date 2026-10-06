// Jobs and gangs as organisations: balance, headcount, ranks, independent of any citizen
// Two member counts on purpose: active job (character) vs player_groups; they can disagree
const express = require('express');
const { db, parseJSON, tableExists } = require('../utils/dbHandler');
const { getJobs, getGangs } = require('../utils/dataLoader');
const { profile } = require('../utils/framework');
const { terms, matches } = require('../utils/search');
const perms = require('../utils/permissions');

const router = express.Router();
const ACCOUNTS_TABLE = 'bank_accounts_new';
const GROUPS_TABLE = 'player_groups';

// Characters per active job name
async function activeCounts(fw) {
    const rows = fw.id === 'esx'
        ? (await db.execute(`SELECT job AS name, COUNT(*) AS n FROM ${fw.table} GROUP BY job`))[0]
        : (await db.execute(
            `SELECT JSON_UNQUOTE(JSON_EXTRACT(job, '$.name')) AS name, COUNT(*) AS n
             FROM ${fw.table} GROUP BY name`))[0];

    const out = {};
    for (const r of rows) {
        if (r.name) out[r.name] = Number(r.n) || 0;
    }
    return out;
}

// Memberships per group and type (player_groups)
async function membershipCounts() {
    if (!await tableExists(GROUPS_TABLE)) return null;

    const [rows] = await db.execute(
        'SELECT `group` AS name, type, COUNT(*) AS n FROM ' + GROUPS_TABLE + ' GROUP BY `group`, type'
    );
    const out = {};
    for (const r of rows) {
        out[`${r.type}:${r.name}`] = Number(r.n) || 0;
    }
    return out;
}

// Balances by account id (society account id = job name)
async function balances() {
    if (!await tableExists(ACCOUNTS_TABLE)) return null;

    const [rows] = await db.execute(`SELECT id, amount, isFrozen, auth FROM ${ACCOUNTS_TABLE}`);
    const out = {};
    for (const r of rows) {
        const auth = parseJSON(r.auth);
        out[r.id] = {
            amount: Number(r.amount) || 0,
            frozen: r.isFrozen === 1 || r.isFrozen === true,
            authorizedCount: Array.isArray(auth) ? auth.length : 0,
        };
    }
    return out;
}

// --- Overview -------------------------------------------------------------
// Money only with accounts.view; without it the page shows less instead of failing
router.get('/api/jobs', async (req, res) => {
    const type = ['job', 'gang', 'all'].includes(req.query.type) ? req.query.type : 'all';
    const words = terms(req.query.search);

    try {
        const fw = await profile();
        const maySeeMoney = !req.user || perms.can(req.user.role, 'accounts.view');

        const [active, memberships, money] = await Promise.all([
            activeCounts(fw),
            membershipCounts(),
            maySeeMoney ? balances() : Promise.resolve(null),
        ]);

        const build = (catalog, kind) => Object.entries(catalog).map(([name, meta]) => {
            const grades = meta?.grades || {};
            const row = {
                name,
                type: kind,
                label: meta?.label || name,
                gradeCount: Object.keys(grades).length,
                // Highest grade: shows whether a rank structure exists
                topGrade: Object.entries(grades)
                    .sort((a, b) => Number(b[0]) - Number(a[0]))[0]?.[1]?.name || null,
                activeMembers: active[name] || 0,
                memberships: memberships ? (memberships[`${kind}:${name}`] ?? 0) : null,
            };

            if (money) {
                const acc = money[name];
                row.account = acc
                    ? { id: name, ...acc }
                    // null (no account row) is not 0: missing setup stays visible
                    : null;
            }
            return row;
        });

        let rows = [];
        if (type === 'all' || type === 'job') rows = rows.concat(build(getJobs(), 'job'));
        if (type === 'all' || type === 'gang') rows = rows.concat(build(getGangs(), 'gang'));

        if (words.length > 0) rows = rows.filter(r => matches([r.name, r.label], words));

        rows.sort((a, b) => (b.account?.amount ?? -1) - (a.account?.amount ?? -1)
            || a.label.localeCompare(b.label));

        res.json({
            organisations: rows,
            count: rows.length,
            moneyVisible: Boolean(money),
            groupsAvailable: memberships !== null,
            totals: money
                ? {
                    held: rows.reduce((s, r) => s + (r.account?.amount || 0), 0),
                    withoutAccount: rows.filter(r => r.account === null).length,
                }
                : null,
        });
    } catch (e) {
        console.error('[Jobs] overview failed:', e.message);
        res.status(500).json({ error: 'Database error while building the overview' });
    }
});

// --- Members --------------------------------------------------------------
router.get('/api/jobs/:name/members', async (req, res) => {
    const name = req.params.name;
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 200);

    try {
        const fw = await profile();

        // Active holders, from the character record
        const [activeRows] = fw.id === 'esx'
            ? await db.execute(
                `SELECT ${fw.selectFields} FROM ${fw.table} WHERE job = ? LIMIT ${limit}`, [name])
            : await db.execute(
                `SELECT ${fw.selectFields} FROM ${fw.table}
                 WHERE JSON_UNQUOTE(JSON_EXTRACT(job, '$.name')) = ? LIMIT ${limit}`, [name]);

        const active = activeRows.map(row => {
            const p = fw.shape(row);
            return { citizenid: p.citizenid, name: p.name, jobLabel: p.jobLabel };
        });

        // Memberships can include people with another active job: meaningful, not a glitch
        let members = null;
        if (await tableExists(GROUPS_TABLE)) {
            const [rows] = await db.execute(
                'SELECT citizenid, type, grade FROM ' + GROUPS_TABLE + ' WHERE `group` = ? LIMIT ' + limit,
                [name]
            );
            members = rows.map(r => ({
                citizenid: r.citizenid,
                type: r.type,
                grade: Number(r.grade) || 0,
                alsoActive: active.some(a => a.citizenid === r.citizenid),
            }));
        }

        res.json({
            organisation: name,
            active,
            activeCount: active.length,
            members,
            memberCount: members ? members.length : null,
            truncated: active.length === limit,
        });
    } catch (e) {
        console.error('[Jobs] member lookup failed:', e.message);
        res.status(500).json({ error: 'Database error while loading the members' });
    }
});

module.exports = { router };
