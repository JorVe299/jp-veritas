// backend/utils/roleStore.js
// Roles as data.
//
// They used to be four constants in the source, which is fine for one
// community and wrong for a server with several teams: a support lead, a
// vehicle team and a whitelist crew need three different sets of
// permissions, and none of them should require a redeploy to create.
//
// So a role is now a record the owner edits:
//
//   { id, label, capabilities: [...], discordUserIds: [], discordRoleIds: [] }
//
// Two invariants hold whatever is in the file, because breaking either one
// locks the owner out of their own panel:
//
//   1. The owner role always exists, always holds every capability, and
//      cannot be deleted.
//   2. The order of the list is the ranking. Whoever matches several roles
//      gets the first one, so the answer never depends on the order the
//      .env happens to be written in.
//
// The Discord mapping deliberately lives in two places. What the owner
// edits here is stored in this file; what is in the .env keeps working and
// is the way back in when this file is wrong - a panel that can edit its
// own door needs a key that is kept somewhere else.

const fs = require('fs');
const path = require('path');

const STORE = path.join(__dirname, '../data/permissions.json');

const OWNER_ROLE = 'owner';

// Shipped with the panel. They can be relabelled, re-permissioned and (all
// but the owner) deleted - they are a starting point, not a fixed set.
const BUILT_IN = ['owner', 'administrator', 'supporter', 'citizen'];

const BUILT_IN_LABELS = {
    owner: 'Owner',
    administrator: 'Administrator',
    supporter: 'Supporter',
    citizen: 'Citizen',
};

// A role id ends up in a signed session and in a JSON file, so it stays
// boring on purpose: lowercase, no spaces, nothing that needs escaping.
const ID_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/;

const MAX_ROLES = 40;
const MAX_LABEL = 48;

function normaliseId(value) {
    return String(value || '').trim().toLowerCase();
}

/** A suggested id for a label, for the common case of not typing one. */
function idFromLabel(label) {
    const slug = String(label || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 32);
    // An id has to start with a letter; prefixing beats refusing a label
    // that was perfectly reasonable to type.
    return /^[a-z]/.test(slug) ? slug : `role-${slug}`.slice(0, 32);
}

function validId(id) {
    return ID_PATTERN.test(id);
}

function cleanLabel(value, fallback) {
    const text = String(value ?? '').trim().replace(/\s+/g, ' ');
    return text ? text.slice(0, MAX_LABEL) : fallback;
}

// Discord snowflakes, and nothing else. A malformed id in this list would
// silently match nobody, which looks exactly like a permission that was
// never granted.
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
        // Unknown capabilities are dropped: otherwise a renamed or removed
        // one leaves a dead entry behind that reads like a granted
        // permission.
        capabilities: id === OWNER_ROLE
            ? capabilityIds.slice()
            : capabilityIds.filter(c => Array.isArray(raw?.capabilities) && raw.capabilities.includes(c)),
        discordUserIds: cleanIdList(raw?.discordUserIds),
        discordRoleIds: cleanIdList(raw?.discordRoleIds),
    };
}

/**
 * Whatever is on disk, turned into a state that holds the invariants.
 *
 * Accepts the old format too - a plain map of role id to capability list -
 * because an installation that has been running since before roles were
 * editable must not lose its settings on upgrade.
 */
function sanitizeState(raw, capabilityIds, defaults) {
    const roles = [];
    const seen = new Set();

    const source = Array.isArray(raw?.roles)
        ? raw.roles
        // The v1 file. Its key order is not meaningful, so the built-in
        // ranking is used instead.
        : BUILT_IN
            .filter(id => Array.isArray(raw?.[id]))
            .map(id => ({ id, label: BUILT_IN_LABELS[id], capabilities: raw[id] }));

    for (const entry of source) {
        const role = sanitizeRole(entry, capabilityIds);
        if (!role || seen.has(role.id)) continue;
        seen.add(role.id);
        roles.push(role);
    }

    // A file that lost the owner, or never had one, still has to produce a
    // panel somebody can get into.
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

    // An empty file means a fresh installation, which gets the starting set
    // rather than a panel with one role in it.
    if (roles.length === 1 && !Array.isArray(raw?.roles) && !BUILT_IN.some(id => Array.isArray(raw?.[id]))) {
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

    // The owner outranks everyone, so it is first whatever the file says.
    const owner = roles.splice(roles.findIndex(r => r.id === OWNER_ROLE), 1)[0];
    owner.capabilities = capabilityIds.slice();

    return { version: 2, roles: [owner, ...roles].slice(0, MAX_ROLES) };
}

function createStore({ capabilityIds, defaults, file }) {
    // Overridable so the tests can run against a scratch file instead of
    // the one a live panel is keeping its roles in.
    const STORE_FILE = file || STORE;
    let state = null;

    function load() {
        if (state) return state;
        try {
            if (fs.existsSync(STORE_FILE)) {
                const raw = fs.readFileSync(STORE_FILE, 'utf8');
                state = sanitizeState(raw.trim() ? JSON.parse(raw) : {}, capabilityIds, defaults);
                return state;
            }
        } catch (e) {
            console.warn(`[Perms] ${STORE_FILE} could not be read (${e.message}) - falling back to the defaults`);
        }
        state = sanitizeState({}, capabilityIds, defaults);
        return state;
    }

    function persist(next) {
        state = sanitizeState(next, capabilityIds, defaults);
        try {
            fs.mkdirSync(path.dirname(STORE_FILE), { recursive: true });
            fs.writeFileSync(STORE_FILE, JSON.stringify(state, null, 2), 'utf8');
        } catch (e) {
            console.error('[Perms] could not write the permission file:', e.message);
            throw new Error('The permissions could not be saved');
        }
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
        // Two roles reading the same in the list is worse than a clash of
        // ids: the ids are what the code keys on, the labels are what a
        // person picks from when granting permissions, and picking the
        // wrong one there is the mistake this whole file exists to avoid.
        if (roles.some(r => r.label.toLowerCase() === wantedLabel.toLowerCase())) {
            throw Object.assign(new Error(`There is already a role named '${wantedLabel}'`), { status: 409 });
        }

        // Copying an existing role is the common case: a second support
        // team usually starts as the first one plus or minus a little.
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
            // Never the owner's set, whatever was copied: a new role that
            // silently held everything would be a lock nobody notices is
            // open.
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
                // The owner's capabilities are not editable. Letting them be
                // would make it possible to take the last key off the last
                // keyring.
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

    /** Move a role up or down the ranking, which is what decides ties. */
    function reorder(orderedIds) {
        const roles = list();
        const byId = new Map(roles.map(r => [r.id, r]));
        const next = [];
        for (const id of orderedIds || []) {
            const role = byId.get(normaliseId(id));
            if (role && !next.includes(role)) next.push(role);
        }
        // Anything the caller forgot keeps its place at the end rather than
        // quietly disappearing.
        for (const role of roles) if (!next.includes(role)) next.push(role);

        persist({ version: 2, roles: next });
        return list();
    }

    /** The capability map the rest of the panel still speaks in. */
    function matrix() {
        const out = {};
        for (const role of list()) out[role.id] = role.capabilities;
        return out;
    }

    /** Replace the capability sets without touching labels or mappings. */
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

module.exports = { createStore, sanitizeState, idFromLabel, validId, cleanIdList, OWNER_ROLE, STORE, BUILT_IN, BUILT_IN_LABELS, MAX_ROLES };
