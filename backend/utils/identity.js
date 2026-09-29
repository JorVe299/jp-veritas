// Discord account -> characters -> identifiers (users.discord -> users.userId -> players.userId)
// SECURITY: the caller says who asks, never which characters; a client citizenid only narrows
const { db, parseJSON, getTableColumns } = require('./dbHandler');
const { profile } = require('./framework');

// Bare snowflake or FiveM's 'discord:' prefix; schemas differ
function discordVariants(discordId) {
    const raw = String(discordId || '').replace(/^discord:/, '').trim();
    if (!/^\d{5,25}$/.test(raw)) return null;
    return [raw, `discord:${raw}`];
}

/** Characters of a Discord account; characters: [] = none yet; null = malformed id */
async function charactersOf(discordId) {
    const variants = discordVariants(discordId);
    if (!variants) return null;

    const fw = await profile();

    // ESX lacks the users/players split: the portal is QB-family only, and says so
    if (fw.id !== 'qb') return { unsupported: fw.label, characters: [] };

    const [rows] = await db.execute(
        `SELECT p.citizenid, p.charinfo, p.job, p.money, p.last_logged_out, u.username
         FROM players p
         JOIN users u ON u.userId = p.userId
         WHERE u.discord IN (?, ?)
         ORDER BY p.last_logged_out DESC`,
        variants
    );

    return {
        unsupported: null,
        username: rows[0]?.username || null,
        characters: rows.map(row => {
            const char = parseJSON(row.charinfo);
            const job = parseJSON(row.job);
            const money = parseJSON(row.money);
            return {
                citizenid: row.citizenid,
                name: `${char.firstname || '?'} ${char.lastname || ''}`.trim(),
                firstname: char.firstname || null,
                lastname: char.lastname || null,
                birthdate: char.birthdate || null,
                nationality: char.nationality || null,
                phone: char.phone || null,
                job: {
                    name: job.name || null,
                    label: job.label || null,
                    grade: job.grade?.name || null,
                    onduty: job.onduty ?? null,
                },
                money: { cash: Number(money.cash) || 0, bank: Number(money.bank) || 0 },
                lastSeen: row.last_logged_out || null,
            };
        }),
    };
}

// SECURITY: ownership check for every portal route taking a citizenid; answered from the DB
async function owns(discordId, citizenid) {
    const variants = discordVariants(discordId);
    if (!variants || !citizenid) return false;

    const fw = await profile();
    if (fw.id !== 'qb') return false;

    const [rows] = await db.execute(
        `SELECT 1 FROM players p
         JOIN users u ON u.userId = p.userId
         WHERE u.discord IN (?, ?) AND p.citizenid = ?
         LIMIT 1`,
        [...variants, citizenid]
    );
    return rows.length > 0;
}

// --- Identifiers ----------------------------------------------------------
// txAdmin bans identifiers, not characters: resolve people to identifiers in txAdmin notation
// Columns vary by framework and schema age, so they are discovered; keys = txAdmin kinds
const IDENTIFIER_COLUMNS = {
    license: 'license',
    license2: 'license2',
    fivem: 'fivem',
    discord: 'discord',
    steam: 'steam',
    live: 'live',
    xbl: 'xbl',
};

// txAdmin notation: lowercase, 'kind:' prefix added where missing
function asIdentifier(kind, value) {
    const raw = String(value ?? '').trim();
    if (!raw) return null;
    const lower = raw.toLowerCase();
    return lower.includes(':') ? lower : `${kind}:${lower}`;
}

/**
 * Every identifier of this Discord account, in txAdmin notation; null for a malformed id
 * Always includes the session's Discord id; users-row ids only widen the match
 * (a ban from before the Discord link carries only a license)
 */
async function identifiersOf(discordId) {
    const variants = discordVariants(discordId);
    if (!variants) return null;

    const out = new Set([`discord:${variants[0]}`]);

    const fw = await profile();
    if (fw.id !== 'qb') return [...out];

    let columns;
    try {
        columns = await getTableColumns('users');
    } catch {
        // No users table: the Discord id alone still matches post-link bans
        return [...out];
    }

    // Column names come only from IDENTIFIER_COLUMNS: nothing to inject
    const present = Object.keys(IDENTIFIER_COLUMNS).filter(c => columns.includes(c));
    if (present.length === 0) return [...out];

    const [rows] = await db.execute(
        `SELECT ${present.join(', ')} FROM users WHERE discord IN (?, ?) LIMIT 1`,
        variants
    );
    if (rows.length === 0) return [...out];

    for (const column of present) {
        const identifier = asIdentifier(IDENTIFIER_COLUMNS[column], rows[0][column]);
        if (identifier) out.add(identifier);
    }
    return [...out];
}

// Discord id behind a character, for diagnostics (panel speaks citizenids, portal Discord ids)
async function discordOf(citizenid) {
    if (!citizenid) return null;
    const fw = await profile();
    if (fw.id !== 'qb') return null;

    const [rows] = await db.execute(
        'SELECT u.discord FROM players p JOIN users u ON u.userId = p.userId WHERE p.citizenid = ? LIMIT 1',
        [citizenid]
    );
    const raw = rows[0] && rows[0].discord;
    if (!raw) return null;
    return String(raw).replace(/^discord:/, '').trim() || null;
}

/**
 * Identifiers of a character's account (panel counterpart to identifiersOf())
 * No ban record stores a citizenid, so "by citizen" filters match on these
 * [] for an unknown character: nothing can belong to it
 */
async function identifiersForCitizen(citizenid) {
    if (!citizenid) return [];

    const fw = await profile();
    if (fw.id !== 'qb') return [];

    let userColumns;
    try {
        userColumns = await getTableColumns('users');
    } catch {
        userColumns = [];
    }
    const present = Object.keys(IDENTIFIER_COLUMNS).filter(c => userColumns.includes(c));

    // players.license exists separately in the QB family and is sometimes the only one set
    const selected = ['p.license AS playerLicense', ...present.map(c => 'u.' + c + ' AS u_' + c)];

    const [rows] = await db.execute(
        'SELECT ' + selected.join(', ') +
        ' FROM players p LEFT JOIN users u ON u.userId = p.userId WHERE p.citizenid = ? LIMIT 1',
        [citizenid]
    );
    if (rows.length === 0) return [];

    const out = new Set();
    const first = asIdentifier('license', rows[0].playerLicense);
    if (first) out.add(first);
    for (const column of present) {
        const identifier = asIdentifier(IDENTIFIER_COLUMNS[column], rows[0]['u_' + column]);
        if (identifier) out.add(identifier);
    }
    return [...out];
}

/**
 * Reverse lookup: identifier -> characters, one query per page
 * A list per identifier: an account can hold several characters, none is preferred
 */
async function citizensByIdentifier(identifiers) {
    const map = new Map();
    const wanted = [...new Set((identifiers || []).map(i => String(i).toLowerCase()))].slice(0, 400);
    if (wanted.length === 0) return map;

    const fw = await profile();
    if (fw.id !== 'qb') return map;

    let userColumns;
    try {
        userColumns = await getTableColumns('users');
    } catch {
        return map;
    }
    const present = Object.keys(IDENTIFIER_COLUMNS).filter(c => userColumns.includes(c));
    if (present.length === 0) return map;

    // Schemas differ on storing the prefix: query both forms, compare normalised
    const values = [];
    for (const id of wanted) {
        values.push(id);
        const colon = id.indexOf(':');
        if (colon > 0) values.push(id.slice(colon + 1));
    }

    const placeholders = values.map(() => '?').join(', ');
    const where = present.map(c => 'LOWER(u.' + c + ') IN (' + placeholders + ')').join(' OR ');
    const params = [];
    for (let i = 0; i < present.length; i++) params.push(...values);

    const [rows] = await db.execute(
        'SELECT p.citizenid, p.charinfo, p.license AS playerLicense, u.username, ' +
        present.map(c => 'u.' + c + ' AS u_' + c).join(', ') +
        ' FROM users u JOIN players p ON p.userId = u.userId WHERE ' + where +
        ' LIMIT 500',
        params
    );

    for (const row of rows) {
        const char = parseJSON(row.charinfo);
        const entry = {
            citizenid: row.citizenid,
            name: `${char.firstname || '?'} ${char.lastname || ''}`.trim(),
            account: row.username || null,
        };
        const owned = [asIdentifier('license', row.playerLicense)];
        for (const column of present) {
            owned.push(asIdentifier(IDENTIFIER_COLUMNS[column], row['u_' + column]));
        }
        for (const identifier of owned) {
            if (!identifier) continue;
            const list = map.get(identifier);
            if (list) { if (!list.some(e => e.citizenid === entry.citizenid)) list.push(entry); }
            else map.set(identifier, [entry]);
        }
    }
    return map;
}

module.exports = {
    charactersOf, owns, discordVariants, identifiersOf, asIdentifier, discordOf,
    identifiersForCitizen, citizensByIdentifier,
};
