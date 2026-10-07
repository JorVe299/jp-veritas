// Roles as editable records: { id, label, capabilities, discordUserIds, discordRoleIds }
// Invariants (BACKEND.md §4): owner always exists, holds everything, is first, cannot be deleted
// List order = rank; the .env mappings stay the way back in if this file is wrong

const fs = require('fs');
const path = require('path');

const STORE = path.join(__dirname, '../data/permissions.json');

const OWNER_ROLE = 'owner';

// Starting set: relabel, re-permission, delete (all but the owner) at will
const BUILT_IN = ['owner', 'administrator', 'supporter', 'citizen'];

const BUILT_IN_LABELS = {
    owner: 'Owner',
    administrator: 'Administrator',
    supporter: 'Supporter',
    citizen: 'Citizen',
};

// Ends up in the session and a JSON file: lowercase, no spaces, nothing to escape
const ID_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/;

const MAX_ROLES = 40;
const MAX_LABEL = 48;

function normaliseId(value) {
    return String(value || '').trim().toLowerCase();
}

/** Id suggested from a label when none is typed */
function idFromLabel(label) {
    const slug = String(label || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 32);
    // Ids start with a letter: prefix rather than refuse the label
    return /^[a-z]/.test(slug) ? slug : `role-${slug}`.slice(0, 32);
}

function validId(id) {
    return ID_PATTERN.test(id);
}

function cleanLabel(value, fallback) {
    const text = String(value ?? '').trim().replace(/\s+/g, ' ');
    return text ? text.slice(0, MAX_LABEL) : fallback;
}

// Snowflakes only: a malformed id matches nobody and looks like a missing grant
function cleanIdList(value) {
    const list = Array.isArray(value)
        ? value
        : String(value || '').split(/[,\s]+/);
    const out = [];
    for (const entry of list) {
        const id = String(entry || '').trim();
        if (/^\d{5,25}$/.test(id) && !out.includes(id)) out.push(id);
    }
    return out.slice(0, 200);
}

function sanitizeRole(raw, capabilityIds) {
    const id = normaliseId(raw?.id);
    if (!validId(id)) return null;

    return {
        id,
        label: cleanLabel(raw?.label, BUILT_IN_LABELS[id] || id),
        // Unknown capabilities dropped: a stale entry would read like a grant
        capabilities: id === OWNER_ROLE
            ? capabilityIds.slice()
            : capabilityIds.filter(c => Array.isArray(raw?.capabilities) && raw.capabilities.includes(c)),
        discordUserIds: cleanIdList(raw?.discordUserIds),
        discordRoleIds: cleanIdList(raw?.discordRoleIds),
    };
}

/** Any on-disk content -> a state that holds the invariants */
function sanitizeState(raw, capabilityIds, defaults) {
    const roles = [];
    const seen = new Set();
    const listed = Array.isArray(raw?.roles);

    for (const entry of listed ? raw.roles : []) {
        const role = sanitizeRole(entry, capabilityIds);
        if (!role || seen.has(role.id)) continue;
        seen.add(role.id);
        roles.push(role);
    }

    // Owner restored if missing: the panel must stay enterable
    if (!seen.has(OWNER_ROLE)) {
        roles.unshift({
            id: OWNER_ROLE,
            label: BUILT_IN_LABELS.owner,
            capabilities: capabilityIds.slice(),
            discordUserIds: [],
            discordRoleIds: [],
        });
        seen.add(OWNER_ROLE);
    }

    // No role list = fresh install: seed the built-in roles
    if (!listed) {
        for (const id of BUILT_IN) {
            if (seen.has(id)) continue;
            roles.push({
                id,
                label: BUILT_IN_LABELS[id],
                capabilities: (defaults[id] || []).filter(c => capabilityIds.includes(c)),
                discordUserIds: [],
                discordRoleIds: [],
            });
            seen.add(id);
        }
    }

    // Owner first, whatever the file says
    const owner = roles.splice(roles.findIndex(r => r.id === OWNER_ROLE), 1)[0];
    owner.capabilities = capabilityIds.slice();

    return { version: 2, roles: [owner, ...roles].slice(0, MAX_ROLES) };
}

/** Actionable reason for a refused write (Node's message names the syscall, not the fix) */
function writeHint(e, file) {
    const dir = path.dirname(file);

    if (e.code === 'EACCES' || e.code === 'EPERM') {
        return `The backend is not allowed to write ${file}. Give the user the panel runs as ownership of that folder - on a Linux install that is usually: sudo chown -R <the service user> ${dir}`;
    }
    if (e.code === 'EROFS') {
        return `${dir} is mounted read-only, so nothing there can be saved.`;
    }
    if (e.code === 'ENOSPC') {
        return 'The disk the panel writes to is full.';
    }
    if (e.code === 'EISDIR') {
        return `${file} is a folder, not a file. Remove it and let the panel create the file itself.`;
    }
    // Most Node messages already start with the code; avoid printing it twice
    const message = String(e.message || 'the write was refused');
    return e.code && !message.startsWith(e.code) ? `${e.code}: ${message}` : message;
}

function createStore({ capabilityIds, defaults, file }) {
    // Overridable: tests use a scratch file
    const STORE_FILE = file || STORE;
    let state = null;

    function load() {
        if (state) return state;
        try {
            if (fs.existsSync(STORE_FILE)) {
                const raw = fs.readFileSync(STORE_FILE, 'utf8');
                const parsed = raw.trim() ? JSON.parse(raw) : {};
                // Content but no role list: shipped roles, with a warning
                if (raw.trim() && !Array.isArray(parsed?.roles)) {
                    console.warn(`[Perms] ${STORE_FILE} holds no role list - starting from the shipped roles. Saving in the panel rewrites the file.`);
                }
                state = sanitizeState(parsed, capabilityIds, defaults);
                return state;
            }
        } catch (e) {
            console.warn(`[Perms] ${STORE_FILE} could not be read (${e.message}) - falling back to the defaults`);
        }
        state = sanitizeState({}, capabilityIds, defaults);
        return state;
    }

    /**
     * Write first, adopt second: a refused write changes nothing (BACKEND.md §4)
     * Temp file + rename: atomic on one filesystem; a half-written file locks everyone out
     */
    function persist(next) {
        const candidate = sanitizeState(next, capabilityIds, defaults);
        const tmp = `${STORE_FILE}.tmp`;

        try {
            fs.mkdirSync(path.dirname(STORE_FILE), { recursive: true });
            fs.writeFileSync(tmp, JSON.stringify(candidate, null, 2), 'utf8');
            fs.renameSync(tmp, STORE_FILE);
        } catch (e) {
            try { fs.unlinkSync(tmp); } catch { /* it may never have been made */ }
            console.error(`[Perms] could not write ${STORE_FILE}: ${e.code || ''} ${e.message}`);

            // hint carries the cause (e.g. folder permissions) to the panel
            const err = new Error('The permissions could not be saved');
            err.status = 500;
            err.hint = writeHint(e, STORE_FILE);
            throw err;
        }

        state = candidate;
        return state;
    }

    function list() {
        return load().roles;
    }

    function get(id) {
        return list().find(r => r.id === normaliseId(id)) || null;
    }

    function create({ id, label, capabilities, copyFrom, discordUserIds, discordRoleIds }) {
        const roles = list();
        if (roles.length >= MAX_ROLES) {
            throw Object.assign(new Error(`A panel may hold at most ${MAX_ROLES} roles`), { status: 400 });
        }

        const wantedLabel = cleanLabel(label, '');
        if (!wantedLabel) {
            throw Object.assign(new Error('A role needs a name'), { status: 400 });
        }

        const wantedId = normaliseId(id) || idFromLabel(wantedLabel);
        if (!validId(wantedId)) {
            throw Object.assign(new Error(
                'A role id must start with a letter and hold only lowercase letters, digits, - and _'
            ), { status: 400 });
        }
        if (roles.some(r => r.id === wantedId)) {
            throw Object.assign(new Error(`There is already a role called '${wantedId}'`), { status: 409 });
        }
        // Duplicate labels refused: people grant by label, so look-alikes invite the wrong pick
        if (roles.some(r => r.label.toLowerCase() === wantedLabel.toLowerCase())) {
            throw Object.assign(new Error(`There is already a role named '${wantedLabel}'`), { status: 409 });
        }

        const source = copyFrom ? get(copyFrom) : null;
        if (copyFrom && !source) {
            throw Object.assign(new Error(`There is no role '${copyFrom}' to copy`), { status: 404 });
        }

        const granted = Array.isArray(capabilities)
            ? capabilities
            : (source ? source.capabilities : []);

        const next = {
            id: wantedId,
            label: wantedLabel,
            // Grantable capabilities only; the owner-only right never transfers
            capabilities: wantedId === OWNER_ROLE ? [] : capabilityIds.filter(c => granted.includes(c)),
            discordUserIds: cleanIdList(discordUserIds),
            discordRoleIds: cleanIdList(discordRoleIds),
        };

        persist({ version: 2, roles: [...roles, next] });
        return get(wantedId);
    }

    function update(id, patch) {
        const target = normaliseId(id);
        const roles = list();
        const found = roles.find(r => r.id === target);
        if (!found) {
            throw Object.assign(new Error(`There is no role '${target}'`), { status: 404 });
        }

        if (patch.label !== undefined) {
            const wanted = cleanLabel(patch.label, found.label).toLowerCase();
            if (roles.some(r => r.id !== target && r.label.toLowerCase() === wanted)) {
                throw Object.assign(new Error(`There is already a role named '${patch.label}'`), { status: 409 });
            }
        }

        const next = roles.map(role => {
            if (role.id !== target) return role;
            return {
                ...role,
                label: patch.label === undefined ? role.label : cleanLabel(patch.label, role.label),
                // SECURITY: owner capabilities are fixed
                capabilities: target === OWNER_ROLE || patch.capabilities === undefined
                    ? role.capabilities
                    : capabilityIds.filter(c => patch.capabilities.includes(c)),
                discordUserIds: patch.discordUserIds === undefined
                    ? role.discordUserIds
                    : cleanIdList(patch.discordUserIds),
                discordRoleIds: patch.discordRoleIds === undefined
                    ? role.discordRoleIds
                    : cleanIdList(patch.discordRoleIds),
            };
        });

        persist({ version: 2, roles: next });
        return get(target);
    }

    function remove(id) {
        const target = normaliseId(id);
        if (target === OWNER_ROLE) {
            throw Object.assign(new Error('The owner role cannot be removed'), { status: 400 });
        }
        const roles = list();
        if (!roles.some(r => r.id === target)) {
            throw Object.assign(new Error(`There is no role '${target}'`), { status: 404 });
        }
        persist({ version: 2, roles: roles.filter(r => r.id !== target) });
        return target;
    }

    /** Applies a new ranking (the tie-breaker between matching roles) */
    function reorder(orderedIds) {
        const roles = list();
        const byId = new Map(roles.map(r => [r.id, r]));
        const next = [];
        for (const id of orderedIds || []) {
            const role = byId.get(normaliseId(id));
            if (role && !next.includes(role)) next.push(role);
        }
        // Unlisted roles are kept (appended), never dropped
        for (const role of roles) if (!next.includes(role)) next.push(role);

        persist({ version: 2, roles: next });
        return list();
    }

    /** { roleId: capabilities[] }, the shape the rest of the panel uses */
    function matrix() {
        const out = {};
        for (const role of list()) out[role.id] = role.capabilities;
        return out;
    }

    /** Replaces capability sets only; labels and mappings untouched */
    function saveMatrix(raw) {
        const next = list().map(role => ({
            ...role,
            capabilities: Array.isArray(raw?.[role.id]) ? raw[role.id] : role.capabilities,
        }));
        persist({ version: 2, roles: next });
        return matrix();
    }

    function reset() {
        state = null;
    }

    return {
        STORE_FILE, OWNER_ROLE, BUILT_IN, MAX_ROLES,
        load, list, get, create, update, remove, reorder,
        matrix, saveMatrix, reset,
        idFromLabel, validId,
    };
}

module.exports = {
    createStore, sanitizeState, idFromLabel, validId, cleanIdList, writeHint,
    OWNER_ROLE, STORE, BUILT_IN, BUILT_IN_LABELS, MAX_ROLES,
};
