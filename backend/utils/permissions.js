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
const fs = require('fs');
const path = require('path');

const STORE = path.join(__dirname, '../data/permissions.json');

// Order = rank, for display only.
const ROLES = ['owner', 'administrator', 'supporter', 'citizen'];

const ROLE_LABELS = {
    owner: 'Owner',
    administrator: 'Administrator',
    supporter: 'Supporter',
    citizen: 'Citizen'
};

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

    { id: 'orgs.view', group: 'Server', label: 'See jobs and gangs as organisations' },
    { id: 'resources.view', group: 'Server', label: 'See the resources on the game server' },
    { id: 'resources.read', group: 'Server', label: 'Read config files out of a resource' },
    { id: 'resources.exec', group: 'Server', label: 'Call exports on any resource' }
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

let matrix = null;

function sanitize(raw) {
    const clean = {};
    for (const role of ROLES) {
        const list = Array.isArray(raw?.[role]) ? raw[role] : DEFAULTS[role];
        // Unknown capabilities are dropped: otherwise every rename would
        // leave dead entries behind that look like granted permissions.
        clean[role] = CAPABILITY_IDS.filter(id => list.includes(id));
    }
    // The owner always keeps everything, whatever the file says.
    clean.owner = CAPABILITY_IDS.slice();
    return clean;
}

function load() {
    if (matrix) return matrix;

    try {
        if (fs.existsSync(STORE)) {
            const raw = fs.readFileSync(STORE, 'utf8');
            matrix = sanitize(raw.trim() ? JSON.parse(raw) : {});
            return matrix;
        }
    } catch (e) {
        console.warn(`[Perms] ${STORE} could not be read (${e.message}) - falling back to the defaults`);
    }

    matrix = sanitize({});
    return matrix;
}

function save(next) {
    matrix = sanitize(next);
    try {
        fs.mkdirSync(path.dirname(STORE), { recursive: true });
        fs.writeFileSync(STORE, JSON.stringify(matrix, null, 2), 'utf8');
    } catch (e) {
        console.error('[Perms] could not write the permission file:', e.message);
        throw new Error('The permissions could not be saved');
    }
    return matrix;
}

function getMatrix() {
    return load();
}

function can(role, capability) {
    if (role === 'owner') return true; // without exception
    if (capability === OWNER_ONLY) return false;
    return load()[role]?.includes(capability) === true;
}

// What may this role do in total? Sent to the frontend so it can hide
// buttons - but the decision is always made here in the backend.
function capabilitiesOf(role) {
    const list = role === 'owner' ? CAPABILITY_IDS.slice() : (load()[role] || []);
    return role === 'owner' ? list.concat(OWNER_ONLY) : list;
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
    ['GET', /^\/api\/system\/framework$/, 'resources.view'],
    ['GET', /^\/api\/system\//, 'system.view'],
    ['GET', /^\/api\/jobs$/, 'orgs.view'],
    ['GET', /^\/api\/jobs\/[^/]+\/members$/, 'orgs.view'],
    ['GET', /^\/api\/resources$/, 'resources.view'],
    ['POST', /^\/api\/resources\/file$/, 'resources.read'],
    ['POST', /^\/api\/resources\/export$/, 'resources.exec'],

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
    ['PUT', /^\/api\/permissions$/, OWNER_ONLY]
];

function requiredFor(method, routePath) {
    const hit = RULES.find(([m, re]) => m === method && re.test(routePath));
    return hit ? hit[2] : null;
}

// Middleware. Anything that matches no rule is denied rather than let
// through: a new route without an entry should stand out, not quietly
// stand open to everyone.
function enforce(req, res, next) {
    if (!req.path.startsWith('/api/')) return next();
    if (req.path.startsWith('/api/auth/')) return next();

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
            error: `Your role (${ROLE_LABELS[role] || role}) is not allowed to do this`,
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
    ROLES, ROLE_LABELS, CAPABILITIES, CAPABILITY_IDS, OWNER_ONLY, DEFAULTS,
    getMatrix, save, can, capabilitiesOf, requiredFor, enforce, STORE, SELF_PREFIX
};
