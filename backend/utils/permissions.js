// Capabilities, the route -> capability table and enforce() (BACKEND.md §4)
// Enforcement is central and fails closed; the owner cannot be locked out

// view/edit split: looking without changing is the common supporter case
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

// SECURITY: owner-only and not in CAPABILITIES, so it can never be configured away
const OWNER_ONLY = 'permissions.edit';

// Citizen portal: guarded by ownership, not by role; outside the rule table
const SELF_PREFIX = '/api/me';

// Initial grants: supporter = day-to-day help, no money, accounts or memberships
const DEFAULTS = {
    owner: CAPABILITY_IDS.slice(),
    // All but permissions.edit (not in CAPABILITY_IDS)
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
    // Empty on purpose: usually mapped to a broad Discord role, and players.view exposes
    // every citizen's personal data; any grant should be a deliberate decision
    // Panel role only; Veritas ID users hold no panel role
    citizen: []
};

// --- Storage --------------------------------------------------------------
// Roles are records in utils/roleStore.js (a JSON file: panel config stays out of the game DB)
const store = require('./roleStore').createStore({
    capabilityIds: CAPABILITY_IDS,
    defaults: DEFAULTS,
});

const STORE = store.STORE;
const OWNER_ROLE = store.OWNER_ROLE;

/** Every role in ranking order; authorize() takes the first match */
function listRoles() {
    return store.list();
}

function getRole(id) {
    return store.get(id);
}

/** Display name; the bare id for a deleted role */
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
    if (role === OWNER_ROLE) return true;
    if (capability === OWNER_ONLY) return false;
    const found = store.get(role);
    // SECURITY: a deleted role grants nothing (fail closed)
    return found ? found.capabilities.includes(capability) : false;
}

/** For the frontend to hide controls; the decision stays with enforce() */
function capabilitiesOf(role) {
    if (role === OWNER_ROLE) return CAPABILITY_IDS.concat(OWNER_ONLY);
    const found = store.get(role);
    return found ? found.capabilities.slice() : [];
}

// --- Route -> capability --------------------------------------------------
// Complete table; unlisted routes are denied, and permissions.test.js fails on a gap

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

// SECURITY: fail closed; a path with no rule is denied
function enforce(req, res, next) {
    // SECURITY: prefix checks are case-blind like the router; RULES stay exact-case,
    // so an odd spelling matches no rule and is denied
    const lower = req.path.toLowerCase();
    if (!lower.startsWith('/api/')) return next();
    if (lower.startsWith('/api/auth/')) return next();

    // No req.user = login disabled (open panel, warned at startup); not a role-less session
    if (!req.user) return next();

    // SECURITY: /api/me[/...] guards itself by ownership; /api/members etc. are not exempt
    if (req.path === SELF_PREFIX || req.path.startsWith(SELF_PREFIX + '/')) return next();

    // SECURITY: signed in without a panel role = portal user; never falls through
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
