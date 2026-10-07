// Ban history: every ban issued or lifted through the panel, kept until someone deletes it
// The `bans` row goes on lift (and qb-core drops expired rows); this record stays (BACKEND.md §4)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { db, tableExists } = require('./dbHandler');
const { identifiersFromRow, TABLE } = require('./banlist');
const { writeHint } = require('./roleStore');

const DEFAULT_FILE = path.join(__dirname, '../data/banlog.json');

// Oldest dropped beyond this: the file is read whole on every request
const MAX_ENTRIES = 5000;

function clean(raw) {
    if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string') return null;
    return {
        id: raw.id,
        banId: Number.isInteger(raw.banId) ? raw.banId : null,
        citizenid: typeof raw.citizenid === 'string' ? raw.citizenid : null,
        name: typeof raw.name === 'string' ? raw.name : null,
        identifiers: Array.isArray(raw.identifiers) ? raw.identifiers.filter(i => typeof i === 'string') : [],
        reason: typeof raw.reason === 'string' ? raw.reason : null,
        permanent: raw.permanent === true,
        expiresAt: typeof raw.expiresAt === 'string' ? raw.expiresAt : null,
        issuedAt: typeof raw.issuedAt === 'string' ? raw.issuedAt : null,
        issuedBy: typeof raw.issuedBy === 'string' ? raw.issuedBy : null,
        liftedAt: typeof raw.liftedAt === 'string' ? raw.liftedAt : null,
        liftedBy: typeof raw.liftedBy === 'string' ? raw.liftedBy : null,
    };
}

function createLog({ file = DEFAULT_FILE } = {}) {
    let entries = null;

    function load() {
        if (entries) return entries;
        try {
            const raw = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
            const parsed = raw.trim() ? JSON.parse(raw) : { entries: [] };
            entries = (Array.isArray(parsed.entries) ? parsed.entries : []).map(clean).filter(Boolean);
        } catch (e) {
            // SECURITY: not adopted as empty; a later write would wipe the history
            const err = new Error(`The ban history could not be read (${e.message})`);
            err.status = 500;
            throw err;
        }
        return entries;
    }

    // Write first, adopt second, as roleStore: a refused write changes nothing
    function persist(next) {
        const tmp = `${file}.tmp`;
        try {
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(tmp, JSON.stringify({ version: 1, entries: next }, null, 2), 'utf8');
            fs.renameSync(tmp, file);
        } catch (e) {
            try { fs.unlinkSync(tmp); } catch { /* it may never have been made */ }
            const err = new Error('The ban history could not be saved');
            err.status = 500;
            err.hint = writeHint(e, file);
            throw err;
        }
        entries = next;
    }

    /** ban: a `bans` row through shapeBan(); by: who pressed the button */
    function recordIssued(ban, { citizenid, by, at = new Date() }) {
        const entry = clean({
            id: crypto.randomUUID(),
            banId: ban.id,
            citizenid,
            name: ban.name,
            identifiers: identifiersFromRow(ban),
            reason: ban.reason,
            permanent: ban.permanent,
            expiresAt: ban.permanent ? null : ban.expiresAt,
            issuedAt: at.toISOString(),
            issuedBy: by,
        });
        persist([entry, ...load()].slice(0, MAX_ENTRIES));
        return entry;
    }

    /** A ban issued in game has no entry yet: one is made from the row, issue date unknown */
    function recordLifted(ban, { by, at = new Date() }) {
        const current = load();
        const index = current.findIndex(e => e.banId === ban.id && !e.liftedAt);
        const lifted = { liftedAt: at.toISOString(), liftedBy: by };

        const next = current.slice();
        if (index >= 0) {
            next[index] = { ...current[index], ...lifted };
        } else {
            next.unshift(clean({
                id: crypto.randomUUID(),
                banId: ban.id,
                name: ban.name,
                identifiers: identifiersFromRow(ban),
                reason: ban.reason,
                permanent: ban.permanent,
                expiresAt: ban.permanent ? null : ban.expiresAt,
                issuedBy: ban.bannedBy || null,
                ...lifted,
            }));
        }
        persist(next.slice(0, MAX_ENTRIES));
    }

    /** Entries for a character id or any of these identifiers (exact, as everywhere) */
    function forPerson({ citizenid = null, identifiers = [] }) {
        const wanted = new Set(identifiers);
        return load().filter(e =>
            (citizenid && e.citizenid === citizenid)
            || e.identifiers.some(i => wanted.has(i)));
    }

    function remove(id) {
        const current = load();
        if (!current.some(e => e.id === id)) return false;
        persist(current.filter(e => e.id !== id));
        return true;
    }

    return { recordIssued, recordLifted, forPerson, remove, all: () => load().slice() };
}

/**
 * State from the entry and whether its `bans` row still exists
 * Row gone without a lift here and before its end: said as such, never guessed
 */
function stateOf(entry, rowExists, now = Date.now()) {
    if (entry.liftedAt) return 'lifted';
    const ended = !entry.permanent && entry.expiresAt && Date.parse(entry.expiresAt) <= now;
    if (ended) return 'ended';
    return rowExists ? 'active' : 'removed';
}

/** Entries with their state; banIds checked against the table in one query */
async function withState(entries) {
    const ids = [...new Set(entries.map(e => e.banId).filter(Number.isInteger))];
    let live = new Set();
    if (ids.length > 0 && await tableExists(TABLE)) {
        const [rows] = await db.execute(
            `SELECT id FROM ${TABLE} WHERE id IN (${ids.map(() => '?').join(',')})`, ids
        );
        live = new Set(rows.map(r => r.id));
    }
    return entries.map(e => ({ ...e, state: stateOf(e, live.has(e.banId)) }));
}

const HISTORY = 'history';

/** Entry (through withState) -> the merged ban shape of utils/banlist.js; never in force */
function asMergedRow(entry) {
    return {
        key: `${HISTORY}:${entry.id}`,
        source: HISTORY,
        type: 'ban',
        nativeId: entry.banId,
        name: entry.name,
        reason: entry.reason,
        issuedBy: entry.issuedBy,
        issuedAt: entry.issuedAt,
        issuedAtKnown: Boolean(entry.issuedAt),
        expiresAt: entry.expiresAt,
        permanent: entry.permanent,
        revoked: entry.state === 'lifted',
        revokedAt: entry.liftedAt,
        expired: entry.state === 'ended',
        active: false,
        identifiers: entry.identifiers,
        citizenid: null,
        canLift: false,
    };
}

module.exports = { createLog, stateOf, withState, asMergedRow, HISTORY, MAX_ENTRIES, log: createLog() };
