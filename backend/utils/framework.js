// Framework profile of the game DB: QB family (players, citizenid, JSON columns) or ESX (users)
// Detected from the tables, not from the bridge: a core can run on unmigrated tables
const { db, parseJSON, getTableColumns } = require('./dbHandler');

const PROFILES = {
    qb: {
        id: 'qb',
        label: 'QBCore / Qbox',
        table: 'players',
        idColumn: 'citizenid',
        selectFields: 'citizenid, charinfo, job, money',

        // Searched expressions (utils/search.js); names also matched as one spaceless string
        searchColumns: [
            'citizenid',
            "JSON_UNQUOTE(JSON_EXTRACT(charinfo, '$.firstname'))",
            "JSON_UNQUOTE(JSON_EXTRACT(charinfo, '$.lastname'))",
        ],
        nameColumns: [
            "JSON_UNQUOTE(JSON_EXTRACT(charinfo, '$.firstname'))",
            "JSON_UNQUOTE(JSON_EXTRACT(charinfo, '$.lastname'))",
        ],

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

        searchColumns: ['identifier', 'firstname', 'lastname'],
        nameColumns: ['firstname', 'lastname'],

        shape(row) {
            // ESX accounts JSON (money, bank, black_money) -> the panel's cash/bank names
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

// Decides from the DB; the bridge's claim is kept: disagreement means a half-migrated server
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
        // For the diagnostics comparison
        bridgeFramework: bridgeFramework || null,
        agrees: !profile || !bridgeFramework
            ? null
            : (profile.id === 'esx') === (bridgeFramework === 'esx'),
        tables: { players: players.length > 0, users: users.length > 0 },
    };
    return detected;
}

// Detected profile, QB as fallback; routes use this instead of hard-coded table names
async function profile() {
    const d = await detect();
    return d.profile || PROFILES.qb;
}

function reset() {
    detected = null;
}

module.exports = { PROFILES, detect, profile, reset };
