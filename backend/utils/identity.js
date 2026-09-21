// backend/utils/identity.js
// Which characters belong to a given Discord account?
//
// The chain already exists in the Qbox schema and needs no migration:
//
//   users.discord = 'discord:<snowflake>'   the account
//   users.userId  -> players.userId          the characters on it
//
// That is the same idea txAdmin uses for admin profiles: the Discord id is
// the identity, the characters hang off it. One account, several characters,
// naturally.
//
// The one rule this file exists to enforce: the caller never says which
// characters to show. It says who is asking, and the answer is derived here.
// A citizenid arriving from a browser is only ever used to narrow a set that
// was already established as theirs.
const { db, parseJSON, getTableColumns } = require('./dbHandler');
const { profile } = require('./framework');

// Discord stores ids as bare snowflakes, FiveM prefixes them. Accept both so
// a schema that was filled by a different script still matches.
function discordVariants(discordId) {
    const raw = String(discordId || '').replace(/^discord:/, '').trim();
    if (!/^\d{5,25}$/.test(raw)) return null;
    return [raw, `discord:${raw}`];
}

// The citizenids owned by this Discord account. Empty array means the
// account has never created a character; null means the id was malformed.
async function charactersOf(discordId) {
    const variants = discordVariants(discordId);
    if (!variants) return null;

    const fw = await profile();

    // ESX has no users/players split in this form, so the portal only
    // supports the QB family for now. Saying so beats returning nothing and
    // letting the caller guess why.
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

// Does this Discord account own this character? Every portal route that
// takes a citizenid calls this first. It answers from the database, not from
// anything the browser sent alongside.
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
// txAdmin bans neither characters nor accounts - it bans identifiers. To
// ask it what is on record against someone, we first have to say who that
// someone is in its terms: every identifier the game database holds for
// them, written the way txAdmin writes them.
//
// Which columns exist varies by framework and by how old the schema is, so
// they are discovered rather than assumed. The keys here are also the
// identifier kinds txAdmin uses, which is why the map looks redundant -
// it is the join between two naming schemes that happen to agree.
const IDENTIFIER_COLUMNS = {
    license: 'license',
    license2: 'license2',
    fivem: 'fivem',
    discord: 'discord',
    steam: 'steam',
    live: 'live',
    xbl: 'xbl',
};

// Some schemas store 'discord:123', others the bare '123'. txAdmin always
// wants the prefixed form, so the prefix is added only where it is missing.
function asIdentifier(kind, value) {
    const raw = String(value ?? '').trim();
    if (!raw) return null;
    const lower = raw.toLowerCase();
    return lower.includes(':') ? lower : `${kind}:${lower}`;
}

/**
 * Every identifier known for this Discord account, in txAdmin's notation.
 *
 * The Discord id itself is always included: it is the one identifier this
 * portal is certain of, because the session was signed with it. The rest
 * come from the users row and only ever widen the match - a ban issued
 * before someone linked their Discord carries a license and nothing else,
 * and without the license lookup it would be invisible to them.
 *
 * Returns null for a malformed Discord id, matching charactersOf().
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
        // No users table on this schema. The Discord id alone still answers
        // the question for anyone banned after linking their account.
        return [...out];
    }

    // Only names from IDENTIFIER_COLUMNS ever reach the query, so there is
    // nothing here for a column name to inject.
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

// The Discord id behind a character, for diagnostics: the panel knows
// citizenids, the portal works in Discord ids, and a question about one
// person has to be askable in whichever of the two is to hand.
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
 * Every identifier a character's account is known by.
 *
 * The counterpart to identifiersOf(), asked in the panel's currency
 * rather than the portal's: staff work in citizenids, and no ban record
 * stores one. Filtering a ban list "by citizen" therefore means resolving
 * that citizen to identifiers first and matching on those.
 *
 * Returns [] for a character that does not exist, which reads correctly
 * downstream: no identifiers, so no ban can belong to them.
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

    // players.license exists on its own in the QB family and is sometimes
    // the only one filled in, so it is read alongside the users row.
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
 * The other direction: which characters sit behind these identifiers.
 *
 * Used to put a name and a citizenid on a ban row. A ban is issued
 * against an account, and an account can hold several characters, so the
 * answer is a list - collapsing it to one would quietly pick a favourite.
 *
 * One query for the whole page rather than one per row.
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

    // Schemas differ on whether the prefix is stored, so both forms go
    // into the query and the comparison happens on the normalised value.
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
