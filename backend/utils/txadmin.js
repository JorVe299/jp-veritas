// backend/utils/txadmin.js
// Reading txAdmin's record of bans and warnings.
//
// txAdmin keeps none of this in the game database. Its players, bans and
// warnings live in a single JSON file beside the server, normally
//
//   <server>/txData/<profile>/data/playersDB.json
//
// which txAdmin itself writes. So this module reads a file rather than a
// table, and it only ever reads. Nothing here writes to that store: two
// processes writing the same JSON file is exactly how a ban list gets
// truncated, and a ban list is not something to be careless with.
//
// A txAdmin action is tied to identifiers, not to a character:
//
//   { id, type: 'ban'|'warn', ids: ['license:..','discord:..'],
//     reason, author, timestamp, expiration, revocation: {...} }
//
// which is why the caller passes in the identifiers of an account and gets
// back what was issued against any of them.
const fs = require('fs');
const path = require('path');

// One explicit setting. It may point at the JSON file, at the profile
// folder, or at txData itself - all three are things a person could
// reasonably have to hand, and guessing wrong should not be a setup step.
const CONFIGURED = (process.env.TXADMIN_DB_PATH || '').trim();

// Whether a player is told which admin issued the ban. Off by default:
// the reason is the player's business, the name of the staff member who
// typed it is a decision for the server owner, and handing it out
// unasked is how a moderator ends up with a direct message.
const SHOW_AUTHOR = process.env.TXADMIN_SHOW_BAN_AUTHOR === 'true';

// A safety valve, not a tuning knob. playersDB.json grows with the server;
// a file far past this is either a very large community that needs the
// path pointed at something else, or not the file we think it is.
const MAX_BYTES = 256 * 1024 * 1024;

const FILE_NAME = 'playersDB.json';

// --- Finding the file -----------------------------------------------------

function fileAt(candidate) {
    try {
        const stat = fs.statSync(candidate);
        if (stat.isFile()) return candidate;
        if (!stat.isDirectory()) return null;
    } catch {
        return null;
    }

    // A profile folder: <profile>/data/playersDB.json
    const direct = path.join(candidate, 'data', FILE_NAME);
    if (fs.existsSync(direct)) return direct;

    // txData itself: pick the profile that has the file. 'default' first,
    // because that is what txAdmin creates unless someone renamed it.
    let entries;
    try {
        entries = fs.readdirSync(candidate, { withFileTypes: true })
            .filter(e => e.isDirectory())
            .map(e => e.name)
            .sort((a, b) => (a === 'default' ? -1 : b === 'default' ? 1 : a.localeCompare(b)));
    } catch {
        return null;
    }
    for (const name of entries) {
        const nested = path.join(candidate, name, 'data', FILE_NAME);
        if (fs.existsSync(nested)) return nested;
    }
    return null;
}

// Without a configured path, look for a txData folder near the panel. The
// usual case is the panel living inside or beside the server directory, so
// a few levels up covers it - and when it does not, the setting exists.
function discover() {
    if (CONFIGURED) {
        // A relative setting resolves against the backend folder rather
        // than the working directory, for the same reason the .env does:
        // where the panel was started from should not change what it reads.
        const found = fileAt(path.resolve(__dirname, '..', CONFIGURED));
        return found
            ? { path: found, source: 'TXADMIN_DB_PATH' }
            : { path: null, source: 'TXADMIN_DB_PATH', bad: CONFIGURED };
    }

    const bases = [];
    let dir = path.resolve(__dirname, '..');
    for (let i = 0; i < 5; i++) {
        bases.push(dir);
        const up = path.dirname(dir);
        if (up === dir) break;
        dir = up;
    }

    for (const base of bases) {
        const found = fileAt(path.join(base, 'txData'));
        if (found) return { path: found, source: 'found next to the panel' };
    }
    return { path: null, source: null };
}

// --- Loading and caching --------------------------------------------------
// The file is re-read only when it changes on disk. txAdmin rewrites it on
// every action, so mtime and size together are a reliable enough signal,
// and the alternative - parsing tens of megabytes per request - is not.

let cache = null; // { path, mtimeMs, size, index, total }

function identifierKey(value) {
    return String(value || '').trim().toLowerCase();
}

// identifier -> [action], built once per file version. Actions are shared
// between entries rather than copied: one action usually carries several
// identifiers for the same person.
function buildIndex(actions) {
    const index = new Map();
    for (const action of actions) {
        if (!action || typeof action !== 'object') continue;
        const ids = Array.isArray(action.ids) ? action.ids : [];
        for (const raw of ids) {
            const key = identifierKey(raw);
            if (!key) continue;
            const bucket = index.get(key);
            if (bucket) bucket.push(action);
            else index.set(key, [action]);
        }
    }
    return index;
}

async function load() {
    const located = discover();
    if (!located.path) {
        return {
            ok: false,
            reason: located.bad
                ? `No ${FILE_NAME} under the configured TXADMIN_DB_PATH`
                : 'txAdmin\'s player database was not found',
            hint: located.bad
                ? `Checked '${located.bad}'. Point TXADMIN_DB_PATH at txData, at a profile folder, or straight at the ${FILE_NAME} file.`
                : `Set TXADMIN_DB_PATH in the backend .env to the txData folder, or to <profile>/data/${FILE_NAME}.`,
        };
    }

    let stat;
    try {
        stat = await fs.promises.stat(located.path);
    } catch (e) {
        return { ok: false, reason: 'txAdmin\'s player database could not be read', hint: e.message };
    }

    if (cache && cache.path === located.path
        && cache.mtimeMs === stat.mtimeMs && cache.size === stat.size) {
        return { ok: true, index: cache.index, total: cache.total, path: located.path };
    }

    if (stat.size > MAX_BYTES) {
        return {
            ok: false,
            reason: 'txAdmin\'s player database is larger than this panel will read',
            hint: `${FILE_NAME} is ${Math.round(stat.size / 1048576)} MB, over the ${MAX_BYTES / 1048576} MB limit.`,
        };
    }

    let parsed;
    try {
        parsed = JSON.parse(await fs.promises.readFile(located.path, 'utf8'));
    } catch (e) {
        // A half-written file during a txAdmin save looks exactly like this.
        // Saying so beats reporting an empty ban history, which would be a
        // statement about the player rather than about the file.
        return {
            ok: false,
            reason: 'txAdmin\'s player database could not be parsed',
            hint: `${path.basename(located.path)}: ${e.message}`,
        };
    }

    const actions = Array.isArray(parsed?.actions) ? parsed.actions : null;
    if (!actions) {
        return {
            ok: false,
            reason: 'That file does not look like a txAdmin player database',
            hint: `Expected an 'actions' array in ${located.path}.`,
        };
    }

    // Only the index is kept. The 'players' array is the bulk of the file
    // and nothing here needs it.
    cache = {
        path: located.path,
        mtimeMs: stat.mtimeMs,
        size: stat.size,
        index: buildIndex(actions),
        total: actions.length,
    };
    return { ok: true, index: cache.index, total: cache.total, path: located.path };
}

// --- Shaping --------------------------------------------------------------

function toIso(seconds) {
    const n = Number(seconds);
    if (!Number.isFinite(n) || n <= 0) return null;
    return new Date(n * 1000).toISOString();
}

// txAdmin writes `expiration: false` for a permanent ban and a unix
// timestamp otherwise. A revoked action keeps its row and gains a
// revocation timestamp rather than being deleted.
function shapeAction(action, nowSeconds) {
    const now = Number.isFinite(nowSeconds) ? nowSeconds : Math.floor(Date.now() / 1000);
    const expiration = action?.expiration;
    const permanent = expiration === false || expiration === null || expiration === undefined;
    const revokedAt = Number(action?.revocation?.timestamp) || null;
    const revoked = Boolean(revokedAt);
    const expired = !permanent && Number(expiration) <= now;

    const shaped = {
        id: action?.id ?? null,
        type: action?.type === 'warn' ? 'warn' : 'ban',
        reason: typeof action?.reason === 'string' ? action.reason : null,
        issuedAt: toIso(action?.timestamp),
        expiresAt: permanent ? null : toIso(expiration),
        permanent,
        revoked,
        revokedAt: toIso(revokedAt),
        expired,
        // The one field a player actually acts on: is this still in force?
        active: !revoked && !expired,
    };

    // Deliberately absent unless switched on: who issued it. Also absent
    // always: hwids and the identifier list, which say more about the
    // account than the ban does.
    if (SHOW_AUTHOR) shaped.author = typeof action?.author === 'string' ? action.author : null;

    return shaped;
}

// --- The one thing this module is for -------------------------------------

/**
 * Every txAdmin action recorded against any of these identifiers.
 *
 * @param {string[]} identifiers  e.g. ['discord:123', 'license:abc']
 * @param {object}   [options]
 * @param {string[]} [options.types]  which action types to return
 */
async function actionsFor(identifiers, options = {}) {
    const state = await load();
    if (!state.ok) return { available: false, reason: state.reason, hint: state.hint };

    const types = Array.isArray(options.types) ? options.types : ['ban'];
    const wanted = new Set(types);

    // One action can be indexed under several of this account's
    // identifiers, so collect by identity before shaping.
    const seen = new Set();
    const picked = [];
    for (const identifier of identifiers || []) {
        const bucket = state.index.get(identifierKey(identifier));
        if (!bucket) continue;
        for (const action of bucket) {
            if (seen.has(action)) continue;
            seen.add(action);
            if (!wanted.has(action?.type === 'warn' ? 'warn' : 'ban')) continue;
            picked.push(action);
        }
    }

    const now = Math.floor(Date.now() / 1000);
    const shaped = picked
        .map(a => shapeAction(a, now))
        .sort((a, b) => String(b.issuedAt || '').localeCompare(String(a.issuedAt || '')));

    return {
        available: true,
        actions: shaped,
        count: shaped.length,
        activeCount: shaped.filter(a => a.active).length,
    };
}

/** Whether the store can be reached at all - for the diagnostics panel. */
async function status() {
    const state = await load();
    return state.ok
        ? { available: true, path: state.path, actions: state.total }
        : { available: false, reason: state.reason, hint: state.hint };
}

/**
 * Why a match did or did not happen.
 *
 * When a ban that plainly exists does not appear for the person it was
 * issued against, exactly two things can be wrong, and neither is visible
 * from outside: the store may not key that action by anything this account
 * is known by, or the account may resolve to fewer identifiers than it
 * should. This answers both.
 *
 * It reports which KINDS of identifier the store uses and whether each of
 * THIS account's identifiers appears - never anyone else's values.
 */
async function describe(identifiers) {
    const state = await load();
    if (!state.ok) return { available: false, reason: state.reason, hint: state.hint };

    const seen = new Set();
    const kinds = new Set();
    let bans = 0;
    let warns = 0;

    for (const [key, bucket] of state.index) {
        const colon = key.indexOf(':');
        kinds.add(colon > 0 ? key.slice(0, colon) : '(no prefix)');
        for (const action of bucket) {
            if (seen.has(action)) continue;
            seen.add(action);
            if (action && action.type === 'warn') warns += 1;
            else bans += 1;
        }
    }

    const checked = (identifiers || []).map(id => ({
        id: identifierKey(id),
        inStore: state.index.has(identifierKey(id)),
    }));

    return {
        available: true,
        path: state.path,
        store: {
            actions: seen.size,
            bans,
            warns,
            identifierKinds: [...kinds].sort(),
        },
        account: {
            identifiers: checked,
            matched: checked.filter(c => c.inStore).length,
        },
    };
}

module.exports = {
    actionsFor, status, describe, shapeAction, buildIndex, identifierKey,
    SHOW_AUTHOR, FILE_NAME,
};
