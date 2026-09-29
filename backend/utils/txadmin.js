// Read-only access to txAdmin's playersDB.json (bans and warnings live there, not in the DB)
// Never writes: two writers on one JSON file is how a ban list gets truncated
// Actions are keyed by identifiers, not characters: { id, type, ids, reason, author, ... }
const fs = require('fs');
const path = require('path');

// Accepts the file, a profile folder or txData itself
const CONFIGURED = (process.env.TXADMIN_DB_PATH || '').trim();

// Off by default: players see the reason, not which staff member issued it
const SHOW_AUTHOR = process.env.TXADMIN_SHOW_BAN_AUTHOR === 'true';

// Safety valve: a larger file is a huge community or the wrong file
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

    // txData itself: first profile with the file; 'default' (txAdmin's own name) first
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

// No setting: look for txData in backend/ and up to four parent folders
function discover() {
    if (CONFIGURED) {
        // Relative to backend/, not the cwd (same reason as the .env path)
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
// Re-parsed only when mtime or size changes (txAdmin rewrites the file on every action)

let cache = null; // { path, mtimeMs, size, index, total }

function identifierKey(value) {
    return String(value || '').trim().toLowerCase();
}

// identifier -> [action], once per file version; one action appears under each of its ids
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
        // Typical mid-save state; must not read as an empty ban history
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

    // Only the index is kept; 'players' is the bulk of the file and unused
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

// expiration: false = permanent, else unix seconds
// Revoked actions stay in the file with a revocation timestamp
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
        // In force now: the field a player acts on
        active: !revoked && !expired,
    };

    // SECURITY: author only with TXADMIN_SHOW_BAN_AUTHOR; hwids and identifiers never
    if (SHOW_AUTHOR) shaped.author = typeof action?.author === 'string' ? action.author : null;

    return shaped;
}

// --- Queries --------------------------------------------------------------

/**
 * Every txAdmin action recorded against any of these identifiers
 * @param {string[]} identifiers  e.g. ['discord:123', 'license:abc']
 * @param {object}   [options]
 * @param {string[]} [options.types]  which action types to return
 */
async function actionsFor(identifiers, options = {}) {
    const state = await load();
    if (!state.ok) return { available: false, reason: state.reason, hint: state.hint };

    const types = Array.isArray(options.types) ? options.types : ['ban'];
    const wanted = new Set(types);

    // Dedupe by object identity: one action sits under several identifiers
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

/**
 * Whole record for staff: adds name, author, identifiers (already shown in the panel's list)
 * Search and filtering happen after merging (routes/bans.js, utils/banlist.js)
 * @param {object}   [options]
 * @param {string[]} [options.types]   which action types to include
 * @param {number}   [options.limit]   default 200, max 1000
 */
async function allActions(options = {}) {
    const state = await load();
    if (!state.ok) return { available: false, reason: state.reason, hint: state.hint };

    const wanted = new Set(Array.isArray(options.types) ? options.types : ['ban']);
    const limit = Math.min(Math.max(parseInt(options.limit, 10) || 200, 1), 1000);
    const now = Math.floor(Date.now() / 1000);

    // Dedupe: the index holds each action once per identifier
    const seen = new Set();
    for (const bucket of state.index.values()) {
        for (const action of bucket) seen.add(action);
    }

    const rows = [];
    let total = 0;
    let activeCount = 0;

    for (const action of seen) {
        const type = action && action.type === 'warn' ? 'warn' : 'ban';
        if (!wanted.has(type)) continue;

        const shaped = shapeAction(action, now);
        // Staff-only fields; the panel's own ban list shows the same data
        shaped.playerName = typeof action.playerName === 'string' ? action.playerName : null;
        shaped.author = typeof action.author === 'string' ? action.author : null;
        shaped.identifiers = Array.isArray(action.ids) ? action.ids.map(identifierKey) : [];

        total += 1;
        if (shaped.active) activeCount += 1;
        rows.push(shaped);
    }

    rows.sort((a, b) => String(b.issuedAt || '').localeCompare(String(a.issuedAt || '')));

    return {
        available: true,
        actions: rows.slice(0, limit),
        count: total,
        activeCount,
        // Lets the page say "showing 200 of 4000"
        truncated: total > limit,
        limit,
        path: state.path,
    };
}

/** Store reachability, for the diagnostics panel */
async function status() {
    const state = await load();
    return state.ok
        ? { available: true, path: state.path, actions: state.total }
        : { available: false, reason: state.reason, hint: state.hint };
}

/**
 * Match diagnostics: identifier kinds the store uses, and which of THIS account's ids it holds
 * Never reveals other accounts' identifier values
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
    actionsFor, allActions, status, describe, shapeAction, buildIndex, identifierKey,
    SHOW_AUTHOR, FILE_NAME,
};
