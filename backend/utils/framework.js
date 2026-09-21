// backend/utils/framework.js
// Which framework's database are we looking at?
//
// The bridge reports which core is running on the game server, but the panel
// also reads the database directly - and there the frameworks differ more
// than in their Lua API:
//
//   QB family : table `players`, keyed on `citizenid`, character data in
//               JSON columns (charinfo, job, money, metadata, inventory)
//   ESX       : table `users`, keyed on `identifier`, flat columns for
//               firstname/lastname/job/job_grade and an `accounts` JSON
//
// Rather than sprinkling if-branches through the routes, each profile says
// how to build the query and how to shape a row. Detection looks at what is
// actually in the database, not at what the bridge claims - a server can run
// a core whose tables were never migrated.
const { db, parseJSON, getTableColumns } = require('./dbHandler');

const PROFILES = {
    qb: {
        id: 'qb',
        label: 'QBCore / Qbox',
        table: 'players',
        idColumn: 'citizenid',
        selectFields: 'citizenid, charinfo, job, money',

        // The columns a search has to look through, already as SQL.
        searchSql: `citizenid LIKE ? OR
                    JSON_UNQUOTE(JSON_EXTRACT(charinfo, '$.firstname')) LIKE ? OR
                    JSON_UNQUOTE(JSON_EXTRACT(charinfo, '$.lastname')) LIKE ?`,
        searchParams: 3,

        shape(row) {
            const char = parseJSON(row.charinfo);
            const job = parseJSON(row.job);
            const money = parseJSON(row.money);
            return {
                citizenid: row.citizenid,
                name: `${char.firstname || '?'} ${char.lastname || ''}`.trim(),
                charinfo: char,
                job,
                jobLabel: `${job.label || 'No job'} - ${job.grade?.name || '-'}`,
                money,
            };
        },
    },

    esx: {
        id: 'esx',
        label: 'ESX Legacy',
        table: 'users',
        idColumn: 'identifier',
        selectFields: 'identifier, firstname, lastname, job, job_grade, accounts',

        searchSql: 'identifier LIKE ? OR firstname LIKE ? OR lastname LIKE ?',
        searchParams: 3,

        shape(row) {
            // ESX keeps cash and bank in one accounts JSON under different
            // names; the panel speaks cash/bank everywhere else.
            const accounts = parseJSON(row.accounts);
            const name = `${row.firstname || '?'} ${row.lastname || ''}`.trim();
            return {
                citizenid: row.identifier,
                name,
                charinfo: { firstname: row.firstname, lastname: row.lastname },
                job: { name: row.job, label: row.job, grade: { level: row.job_grade } },
                jobLabel: `${row.job || 'No job'} - ${row.job_grade ?? '-'}`,
                money: {
                    cash: Number(accounts.money) || 0,
                    bank: Number(accounts.bank) || 0,
                    black: Number(accounts.black_money) || 0,
                },
            };
        },
    },
};

let detected = null;

// Looks at the database itself. The bridge's opinion is recorded alongside,
// because the two disagreeing is worth seeing: a QBCore server with ESX
// tables means something got half-migrated.
async function detect(bridgeFramework) {
    if (detected) return detected;

    const players = await getTableColumns('players');
    const users = await getTableColumns('users');

    let profile = null;
    if (players.includes('citizenid')) {
        profile = PROFILES.qb;
    } else if (users.includes('identifier') && users.includes('accounts')) {
        profile = PROFILES.esx;
    }

    detected = {
        profile,
        // What the bridge said, for comparison in the diagnostics.
        bridgeFramework: bridgeFramework || null,
        agrees: !profile || !bridgeFramework
            ? null
            : (profile.id === 'esx') === (bridgeFramework === 'esx'),
        tables: { players: players.length > 0, users: users.length > 0 },
    };
    return detected;
}

// The profile, or the QB one as a fallback. Every route that reads player
// data goes through this rather than hard-coding a table name.
async function profile() {
    const d = await detect();
    return d.profile || PROFILES.qb;
}

function reset() {
    detected = null;
}

module.exports = { PROFILES, detect, profile, reset };
