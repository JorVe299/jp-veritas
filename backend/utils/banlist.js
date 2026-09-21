// backend/utils/banlist.js
// One list out of two ban records.
//
// A server bans in two places: the framework's `bans` table, which this
// panel writes and can lift, and txAdmin's own file, which it can only
// read. Showing them as separate lists made the gap visible; showing them
// as one list makes them usable - as long as it never becomes unclear
// which entry came from where, because only one of the two can be lifted
// here.
//
// Neither record stores a citizenid. Both store identifiers, so a question
// about a person is answered by resolving that person to their identifiers
// and matching on those. That resolution happens in identity.js; this file
// only ever compares already-normalised strings.
//
// One honest gap runs through everything below: the `bans` table has no
// created-at column. Its rows carry no date at all, and inventing one from
// the row id would be a number dressed up as a fact. They sort by id among
// themselves and are marked as undated.

const { asIdentifier } = require('./identity');

const DATABASE = 'database';
const TXADMIN = 'txadmin';

// The identifier kinds a ban can be keyed by, mapped from the column names
// the bans table happens to use.
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

/**
 * A row of the `bans` table in the shared shape.
 *
 * shapeBan() in routes/bans.js has already worked out `active`, `permanent`
 * and the expiry, so this takes that result rather than the raw row.
 */
function fromDatabase(ban) {
    return {
        key: `${DATABASE}:${ban.id}`,
        source: DATABASE,
        type: 'ban',
        nativeId: ban.id,
        name: ban.name || null,
        reason: ban.reason || null,
        issuedBy: ban.bannedBy || null,

        // The table records no date. Saying null is the truth; the list
        // says so out loud rather than letting a blank read as "just now".
        issuedAt: null,
        issuedAtKnown: false,

        expiresAt: ban.expiresAt || null,
        permanent: ban.permanent === true,
        // The table has no revocation concept: lifting a ban deletes the
        // row. So a row that exists was never lifted.
        revoked: false,
        revokedAt: null,
        expired: !ban.permanent && ban.active === false,
        active: ban.active === true,

        identifiers: identifiersFromRow(ban),
        citizenid: null,

        // The whole reason the source has to stay visible.
        canLift: true,
    };
}

/** A txAdmin action, as utils/txadmin.js already shapes it. */
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

        // txAdmin owns that file. Nothing here writes to it.
        canLift: false,
    };
}

/**
 * The order the list is always in: what applies now, newest first.
 *
 * Two keys, in this order, because that is the order the questions get
 * asked - "who is kept out right now" comes before "and when".
 *
 *   1. in force before over
 *   2. newest first
 *
 * Rows the `bans` table could not date come after the dated ones inside
 * their group rather than being scattered through them by a guess, and
 * fall back to id order among themselves.
 */
function compareBans(a, b) {
    if (a.active !== b.active) return a.active ? -1 : 1;

    const aDated = Boolean(a.issuedAt);
    const bDated = Boolean(b.issuedAt);
    if (aDated !== bDated) return aDated ? -1 : 1;

    if (aDated && bDated && a.issuedAt !== b.issuedAt) {
        return a.issuedAt < b.issuedAt ? 1 : -1;
    }

    // Undated rows: the higher id was added later.
    const an = Number(a.nativeId);
    const bn = Number(b.nativeId);
    if (Number.isFinite(an) && Number.isFinite(bn) && an !== bn) return bn - an;

    return String(a.key).localeCompare(String(b.key));
}

function sortBans(rows) {
    return [...rows].sort(compareBans);
}

/**
 * Free text over everything a person would reasonably type.
 *
 * citizenid is in the haystack for rows that already carry one, but the
 * caller must not rely on that alone: the reverse lookup runs on the page
 * being sent, so rows are usually still unresolved here. The route
 * resolves a citizenid-shaped term to identifiers separately.
 */
function matchesQuery(row, needle) {
    if (!needle) return true;
    const hay = [
        row.name, row.reason, row.issuedBy, row.citizenid,
        row.nativeId, row.source,
        ...(row.identifiers || []),
    ].filter(Boolean).join(' ').toLowerCase();
    return hay.includes(needle);
}

/**
 * Does this entry belong to someone with these identifiers?
 *
 * Both sides are already normalised - lowercased and prefixed - so this is
 * a plain set intersection. It has to be: a near-match on an identifier is
 * not a weaker answer, it is the wrong person.
 */
function belongsTo(row, identifierSet) {
    if (!identifierSet || identifierSet.size === 0) return false;
    return (row.identifiers || []).some(id => identifierSet.has(id));
}

module.exports = {
    DATABASE, TXADMIN,
    fromDatabase, fromTxAdmin,
    compareBans, sortBans, matchesQuery, belongsTo,
    identifiersFromRow,
};
