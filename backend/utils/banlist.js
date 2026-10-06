// Merges both ban records (`bans` table: writable; txAdmin file: read-only) into one shape
// Matching is by normalised identifiers only; neither record stores a citizenid
// `bans` rows carry no date: shown undated, never a date guessed from the id (BACKEND.md §8)

const { db, tableExists } = require('./dbHandler');
const { asIdentifier } = require('./identity');
const { terms, matches } = require('./search');

const TABLE = 'bans';

// Signed INT(11) ceiling on qb-core/qbx_core; the game bans while os.time() < expire
// Written for permanent bans, as qb-adminmenu does (BACKEND.md §8)
const PERMANENT_EXPIRE = 2147483647;

// 0, or a far-future value on a wider column, also reads as permanent
const PERMANENT_AFTER_YEARS = 50;

/**
 * Raw `bans` row -> panel shape
 * Shared by the staff list and the portal: one definition of "permanent"
 */
function shapeBan(row) {
    const expire = Number(row.expire) || 0;
    const permanent = expire === 0
        || expire >= PERMANENT_EXPIRE
        || expire > Date.now() / 1000 + PERMANENT_AFTER_YEARS * 31536000;
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

/**
 * `expire` to write for a ban of `days` days (0 = permanent); pairs with shapeBan()
 * Timed bans capped at the ceiling too: strict-mode MySQL refuses overflow (from 2028 on)
 */
function expiryFor(days, nowSeconds = Math.floor(Date.now() / 1000)) {
    if (days === 0) return PERMANENT_EXPIRE;
    return Math.min(Math.floor(nowSeconds + days * 86400), PERMANENT_EXPIRE);
}

/** Database bans against any of these identifiers (license, discord, ip; exact match) */
async function databaseBansFor(identifiers) {
    if (!identifiers || identifiers.length === 0) return { available: true, rows: [] };
    if (!await tableExists(TABLE)) {
        return { available: false, reason: `Table '${TABLE}' does not exist in this database`, rows: [] };
    }

    // Schemas differ on storing the prefix: query both forms, decide on the normalised value
    const values = [];
    for (const id of identifiers) {
        values.push(id);
        const colon = id.indexOf(':');
        if (colon > 0) values.push(id.slice(colon + 1));
    }
    const placeholders = values.map(() => '?').join(', ');
    const columns = ['license', 'discord', 'ip'];
    const where = columns.map(c => `LOWER(${c}) IN (${placeholders})`).join(' OR ');
    const params = [];
    for (let i = 0; i < columns.length; i++) params.push(...values);

    const [raw] = await db.execute(
        `SELECT * FROM ${TABLE} WHERE ${where} ORDER BY id DESC LIMIT 500`,
        params
    );

    // SQL narrows, belongsTo() decides: LOWER() says nothing about how the column was written
    const wanted = new Set(identifiers);
    const rows = raw
        .map(shapeBan)
        .map(fromDatabase)
        .filter(row => belongsTo(row, wanted));

    return { available: true, rows };
}

const DATABASE = 'database';
const TXADMIN = 'txadmin';

// Identifier kind per `bans` column
const DATABASE_IDENTIFIER_COLUMNS = {
    license: 'license',
    discord: 'discord',
    ip: 'ip',
};

function identifiersFromRow(row) {
    const out = [];
    for (const [column, kind] of Object.entries(DATABASE_IDENTIFIER_COLUMNS)) {
        const identifier = asIdentifier(kind, row[column]);
        if (identifier && !out.includes(identifier)) out.push(identifier);
    }
    return out;
}

/** `bans` row (already through shapeBan) -> merged shape */
function fromDatabase(ban) {
    return {
        key: `${DATABASE}:${ban.id}`,
        source: DATABASE,
        type: 'ban',
        nativeId: ban.id,
        name: ban.name || null,
        reason: ban.reason || null,
        issuedBy: ban.bannedBy || null,

        // No date column: null and flagged, never a blank that reads as "just now"
        issuedAt: null,
        issuedAtKnown: false,

        expiresAt: ban.expiresAt || null,
        permanent: ban.permanent === true,
        // Lifting deletes the row: an existing row was never revoked
        revoked: false,
        revokedAt: null,
        expired: !ban.permanent && ban.active === false,
        active: ban.active === true,

        identifiers: identifiersFromRow(ban),
        citizenid: null,

        // Why the source stays visible: only these can be lifted here
        canLift: true,
    };
}

/** txAdmin action (as shaped by utils/txadmin.js) -> merged shape */
function fromTxAdmin(action) {
    return {
        key: `${TXADMIN}:${action.id ?? 'unknown'}`,
        source: TXADMIN,
        type: action.type === 'warn' ? 'warn' : 'ban',
        nativeId: action.id ?? null,
        name: action.playerName || null,
        reason: action.reason || null,
        issuedBy: action.author || null,

        issuedAt: action.issuedAt || null,
        issuedAtKnown: Boolean(action.issuedAt),

        expiresAt: action.expiresAt || null,
        permanent: action.permanent === true,
        revoked: action.revoked === true,
        revokedAt: action.revokedAt || null,
        expired: action.expired === true,
        active: action.active === true,

        identifiers: Array.isArray(action.identifiers) ? action.identifiers : [],
        citizenid: null,

        // Read-only: txAdmin owns the file
        canLift: false,
    };
}

/**
 * List order: in force before over, then newest first
 * Undated `bans` rows follow the dated ones within their group, by id
 */
function compareBans(a, b) {
    if (a.active !== b.active) return a.active ? -1 : 1;

    const aDated = Boolean(a.issuedAt);
    const bDated = Boolean(b.issuedAt);
    if (aDated !== bDated) return aDated ? -1 : 1;

    if (aDated && bDated && a.issuedAt !== b.issuedAt) {
        return a.issuedAt < b.issuedAt ? 1 : -1;
    }

    // Undated rows: higher id = added later
    const an = Number(a.nativeId);
    const bn = Number(b.nativeId);
    if (Number.isFinite(an) && Number.isFinite(bn) && an !== bn) return bn - an;

    return String(a.key).localeCompare(String(b.key));
}

function sortBans(rows) {
    return [...rows].sort(compareBans);
}

/**
 * Free-text match over the visible fields
 * citizenid is usually still unresolved here; the route resolves citizenid terms separately
 */
/** query: raw text; see utils/search.js for how it is read */
function matchesQuery(row, query) {
    return matches([
        row.name, row.reason, row.issuedBy, row.citizenid,
        row.nativeId, row.source,
        ...(row.identifiers || []),
    ], terms(query));
}

/** Exact set intersection on normalised identifiers: a near match is the wrong person */
function belongsTo(row, identifierSet) {
    if (!identifierSet || identifierSet.size === 0) return false;
    return (row.identifiers || []).some(id => identifierSet.has(id));
}

module.exports = {
    DATABASE, TXADMIN, TABLE, PERMANENT_EXPIRE,
    shapeBan, expiryFor, databaseBansFor,
    fromDatabase, fromTxAdmin,
    compareBans, sortBans, matchesQuery, belongsTo,
    identifiersFromRow,
};
