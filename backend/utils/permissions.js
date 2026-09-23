// backend/utils/permissions.js
// Roles and permissions of the panel.
//
// Two principles that explain the rest:
//
// 1. Enforcement is central. Below is a route -> capability table, and a
//    single middleware applies it. Scattering the checks across every
//    route means one of them eventually gets forgotten - and a missing
//    check is not something you can see from the outside.
//
// 2. The owner cannot lock themselves out. Their permissions are not
//    configurable, and only they may hand out permissions at all.
// The capabilities, grouped by area. 'view' and 'edit' are deliberately
// separate: being allowed to look at an inventory without being allowed
// to change it is the most common case for supporters.
const CAPABILITIES = [
    { id: 'players.view', group: 'Players', label: 'See the citizen list and details' },
    { id: 'money.edit', group: 'Players', label: 'Change cash and bank balance' },
    { id: 'job.edit', group: 'Players', label: 'Set job and grade' },
    { id: 'charinfo.edit', group: 'Players', label: 'Rename and change phone number' },

    { id: 'inventory.view', group: 'Inventory', label: 'See the inventory' },
    { id: 'inventory.edit', group: 'Inventory', label: 'Add, remove and move items' },

    { id: 'vehicles.view', group: 'Vehicles', label: 'See owned vehicles' },
    { id: 'vehicles.edit', group: 'Vehicles', label: 'Add, change and delete vehicles' },

    { id: 'metadata.view', group: 'Condition', label: 'See licences and condition' },
    { id: 'licenses.edit', group: 'Condition', label: 'Grant and revoke licences' },
    { id: 'status.edit', group: 'Condition', label: 'Change hunger, stress, armor and jail time' },

    { id: 'groups.view', group: 'Groups', label: 'See job and gang memberships' },
    { id: 'groups.edit', group: 'Groups', label: 'Add and remove memberships' },

    { id: 'accounts.view', group: 'Banking', label: 'See bank accounts' },
    { id: 'accounts.edit', group: 'Banking', label: 'Change balances and freeze accounts' },

    { id: 'bans.view', group: 'Moderation', label: 'See bans' },
    { id: 'bans.edit', group: 'Moderation', label: 'Ban and unban' },
    { id: 'actions.live', group: 'Moderation', label: 'Kick, revive, heal, teleport, notify' },

    { id: 'system.view', group: 'System', label: 'See diagnostics and schema' },
    { id: 'system.edit', group: 'System', label: 'Reload game data' },

    { id: 'orgs.view', group: 'Server', label: 'See jobs and gangs as organisations' }
];

const CAPABILITY_IDS = CAPABILITIES.map(c => c.id);

// Only the owner may hand out permissions. This deliberately does NOT
// live in CAPABILITIES: if it did, it could be configured away, and then
// nobody could change anything any more.
const OWNER_ONLY = 'permissions.edit';

// Everything below this path belongs to the citizen portal and is guarded by
// ownership rather than by a role, so the rule table does not cover it.
const SELF_PREFIX = '/api/me';

// Starting distribution. Supporters may look and help day to day, but not
// touch money, accounts or memberships; a citizen may only look.
const DEFAULTS = {
    owner: CAPABILITY_IDS.slice(),
    // Everything except handing out permissions - that is not in CAPABILITY_IDS.
    administrator: CAPABILITY_IDS.slice(),
    supporter: [
        'players.view',
        'inventory.view', 'inventory.edit',
        'vehicles.view',
        'metadata.view', 'status.edit',
        'groups.view',
        'bans.view',
        'actions.live',
        'system.view',
        'orgs.view'
    ],
    // Nothing at all, on purpose. This role is normally mapped to a broad
    // Discord role, and 'players.view' would hand everyone holding it the
    // full citizen list - phone numbers, birthdates, account numbers - plus
    // the inventory, vehicles and licences of every character. That is a
    // lot to grant by simply existing. The owner can tick whatever this
    // role should actually see in the permissions sheet; starting from
    // nothing means the grant is a decision rather than an oversight.
    //
    // Note this is the PANEL role called Citizen, which is a different
    // thing from a Veritas ID user: a portal user holds no panel role at
    // all and only ever sees their own characters.
    citizen: []
};

// --- Storage ---------------------------------------------------------------
// A JSON file rather than a table: this is configuration, not data. Writing
// panel settings into the Qbox database, which belongs to the game server,
// would be the wrong place for them.

// Roles live in utils/roleStore.js now: they are records the owner edits
// rather than constants in this file. What stays here is the part that has
// to be code - which capabilities exist, which route needs which, and the
// two rules that keep an owner from locking themselves out.
const store = require('./roleStore').createStore({
    capabilityIds: CAPABILITY_IDS,
    defaults: DEFAULTS,
});

const STORE = store.STORE;
const OWNER_ROLE = store.OWNER_ROLE;

/** Every role, in ranking order. The first match wins in authorize(). */
function listRoles() {
    return store.list();
}

function getRole(id) {
    return store.get(id);
}

/** A role's display name, or the id itself for one that no longer exists. */
function labelOf(id) {
    const role = store.get(id);
    return role ? role.label : (id || null);
}

function roleIds() {
    return store.list().map(r => r.id);
}

function getMatrix() {
    return store.matrix();
}

function save(next) {
    return store.saveMatrix(next);
}

function can(role, capability) {
    if (role === OWNER_ROLE) return true; // without exception
    if (capability === OWNER_ONLY) return false;
    const found = store.get(role);
    // A session naming a role that has since been deleted holds nothing.
    // Failing closed is the only safe reading: the alternative is a
    // permission that outlives the role it came from.
    return found ? found.capabilities.includes(capability) : false;
}

// What may this role do in total? Sent to the frontend so it can hide
// buttons - but the decision is always made here in the backend.
function capabilitiesOf(role) {
    if (role === OWNER_ROLE) return CAPABILITY_IDS.concat(OWNER_ONLY);
    const found = store.get(role);
    return found ? found.capabilities.slice() : [];
}

// --- Route -> capability -------------------------------------------------
// The complete mapping, readable in one place. Anything missing here is
// not therefore free - see enforce() below.

const RULES = [
    // Reading
    ['GET', /^\/api\/players$/, 'players.view'],
    ['GET', /^\/api\/players\/[^/]+$/, 'players.view'],
    ['GET', /^\/api\/players\/[^/]+\/inventory$/, 'inventory.view'],
    ['GET', /^\/api\/players\/[^/]+\/vehicles$/, 'vehicles.view'],
    ['GET', /^\/api\/players\/[^/]+\/metadata$/, 'metadata.view'],
    ['GET', /^\/api\/players\/[^/]+\/groups$/, 'groups.view'],
    ['GET', /^\/api\/players\/[^/]+\/accounts$/, 'accounts.view'],
    ['GET', /^\/api\/players\/[^/]+\/bans$/, 'bans.view'],
    ['GET', /^\/api\/players\/[^/]+\/position$/, 'players.view'],
    ['GET', /^\/api\/accounts$/, 'accounts.view'],
    ['GET', /^\/api\/bans\/all$/, 'bans.view'],
    ['GET', /^\/api\/bans\/txadmin$/, 'bans.view'],
    ['GET', /^\/api\/bans$/, 'bans.view'],
    ['GET', /^\/api\/items\/[^/]+\/image$/, 'inventory.view'],
    ['GET', /^\/api\/meta\//, 'players.view'],
    ['GET', /^\/api\/system\/framework$/, 'system.view'],
    ['GET', /^\/api\/system\//, 'system.view'],
    ['GET', /^\/api\/jobs$/, 'orgs.view'],
    ['GET', /^\/api\/jobs\/[^/]+\/members$/, 'orgs.view'],

    // Writing
    ['POST', /^\/api\/manage\/money$/, 'money.edit'],
    ['POST', /^\/api\/manage\/job$/, 'job.edit'],
    ['POST', /^\/api\/manage\/charinfo$/, 'charinfo.edit'],
    ['POST', /^\/api\/manage\/inventory$/, 'inventory.edit'],
    ['POST', /^\/api\/manage\/vehicle$/, 'vehicles.edit'],
    ['POST', /^\/api\/manage\/vehicle\/[^/]+\/properties$/, 'vehicles.edit'],
    ['PATCH', /^\/api\/manage\/vehicle\/[^/]+$/, 'vehicles.edit'],
    ['DELETE', /^\/api\/manage\/vehicle\/[^/]+$/, 'vehicles.edit'],
    ['POST', /^\/api\/manage\/license$/, 'licenses.edit'],
    ['POST', /^\/api\/manage\/status$/, 'status.edit'],
    ['POST', /^\/api\/manage\/group$/, 'groups.edit'],
    ['DELETE', /^\/api\/manage\/group$/, 'groups.edit'],
    ['POST', /^\/api\/manage\/account$/, 'accounts.edit'],
    ['POST', /^\/api\/manage\/account\/freeze$/, 'accounts.edit'],
    ['POST', /^\/api\/manage\/ban$/, 'bans.edit'],
    ['DELETE', /^\/api\/manage\/ban\/[^/]+$/, 'bans.edit'],
    ['POST', /^\/api\/manage\/kick$/, 'actions.live'],
    ['POST', /^\/api\/manage\/revive$/, 'actions.live'],
    ['POST', /^\/api\/manage\/heal$/, 'actions.live'],
    ['POST', /^\/api\/manage\/teleport$/, 'actions.live'],
    ['POST', /^\/api\/manage\/notify$/, 'actions.live'],
    ['POST', /^\/api\/system\/refresh$/, 'system.edit'],

    // Permission management
    ['GET', /^\/api\/permissions$/, 'players.view'],
    ['PUT', /^\/api\/permissions$/, OWNER_ONLY],
    ['POST', /^\/api\/permissions\/roles$/, OWNER_ONLY],
    ['PATCH', /^\/api\/permissions\/roles\/[^/]+$/, OWNER_ONLY],
    ['DELETE', /^\/api\/permissions\/roles\/[^/]+$/, OWNER_ONLY],
    ['PUT', /^\/api\/permissions\/roles\/order$/, OWNER_ONLY],
];

function requiredFor(method, routePath) {
    const hit = RULES.find(([m, re]) => m === method && re.test(routePath));
    return hit ? hit[2] : null;
}

// Middleware. Anything that matches no rule is denied rather than let
// through: a new route without an entry should stand out, not quietly
// stand open to everyone.
function enforce(req, res, next) {
    // Case-blind, like the router: '/API/players' is the players route, and
    // an exact-case check here would let it past with no rule applied. The
    // rules themselves stay exact, so an odd spelling matches none of them
    // and is denied.
    const lower = req.path.toLowerCase();
    if (!lower.startsWith('/api/')) return next();
    if (lower.startsWith('/api/auth/')) return next();

    // No session object at all means Discord login is switched off. Then
    // there are no roles to enforce and the startup banner already says the
    // panel is open. This is NOT the same as a session without a role.
    if (!req.user) return next();

    // The citizen portal is scoped by identity, not by role: those routes
    // never trust a citizenid from the client, they derive what may be seen
    // from the signed-in Discord account. They carry their own guard.
    if (req.path === SELF_PREFIX || req.path.startsWith(SELF_PREFIX + '/')) return next();

    // A signed-in account with no panel role is a portal user. Letting that
    // fall through would hand them every admin route - the one mistake this
    // whole file exists to prevent.
    const role = req.user.role;
    if (!role) {
        return res.status(403).json({
            error: 'This account has no role on the admin panel',
            hint: 'It can use the citizen portal. Admin access is granted through the role mapping in the backend .env.'
        });
    }

    const needed = requiredFor(req.method, req.path);

    if (!needed) {
        console.warn(`[Perms] no rule for ${req.method} ${req.path} - denied`);
        return res.status(403).json({
            error: 'This action has no permission rule and is therefore blocked',
            hint: 'Add the route to RULES in backend/utils/permissions.js.'
        });
    }

    if (!can(role, needed)) {
        return res.status(403).json({
            error: `Your role (${labelOf(role) || role}) is not allowed to do this`,
            required: needed,
            role,
            hint: needed === OWNER_ONLY
                ? 'Only the owner can change permissions.'
                : 'An owner can grant this in the Permissions card.'
        });
    }

    next();
}

module.exports = {
    CAPABILITIES, CAPABILITY_IDS, OWNER_ONLY, DEFAULTS,
    OWNER_ROLE, BUILT_IN_ROLES: store.BUILT_IN, MAX_ROLES: store.MAX_ROLES,
    listRoles, getRole, labelOf, roleIds,
    createRole: store.create, updateRole: store.update,
    deleteRole: store.remove, reorderRoles: store.reorder,
    getMatrix, save, can, capabilitiesOf, requiredFor, enforce, STORE, SELF_PREFIX,
};

// Kept as getters so callers written against the old constants keep
// working while roles were still four names in the source.
Object.defineProperty(module.exports, 'ROLES', { get: roleIds, enumerable: true });
Object.defineProperty(module.exports, 'ROLE_LABELS', {
    enumerable: true,
    get() {
        const out = {};
        for (const role of listRoles()) out[role.id] = role.label;
        return out;
    },
});
