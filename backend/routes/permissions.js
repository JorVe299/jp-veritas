// backend/routes/permissions.js
// Reading and setting the roles and what they may do.
//
// Anyone signed in may read the list: the frontend needs it to explain why
// a button is missing. Only the owner may write, and the central middleware
// in utils/permissions.js already enforces that - the check appears a
// second time here because permission management is the wrong place to
// trust exactly one line of code.
const express = require('express');
const perms = require('../utils/permissions');

const router = express.Router();

// Without an active Discord login there is no role, and enforce() then lets
// everything through. In that case canEdit has to report true as well:
// otherwise the UI disables a button the server would happily accept - and
// the panel would be claiming something untrue about itself.
const authDisabled = (req) => !req.user;
const mayEdit = (req) => authDisabled(req) || req.user?.role === perms.OWNER_ROLE;

function guard(req, res) {
    if (mayEdit(req)) return true;
    res.status(403).json({ error: 'Only the owner can change roles or permissions' });
    return false;
}

// An error thrown by the role store carries the status it deserves.
function fail(res, e) {
    const status = Number(e?.status) || 500;
    if (status >= 500) console.error('[Perms] role change failed:', e.message);
    res.status(status).json({ error: e.message });
}

router.get('/api/permissions', (req, res) => {
    const role = req.user?.role || null;
    const canEdit = mayEdit(req);

    res.json({
        roles: perms.listRoles().map(r => ({
            id: r.id,
            label: r.label,
            capabilityCount: r.capabilities.length,
            // The owner is not editable - that has to be visible, so that
            // nobody tries in vain to tick boxes there.
            locked: r.id === perms.OWNER_ROLE,
            builtIn: perms.BUILT_IN_ROLES.includes(r.id),
            // Who is mapped to it is only shown to whoever may change it:
            // a Discord id list is not something every signed-in supporter
            // needs to read.
            discordUserIds: canEdit ? r.discordUserIds : undefined,
            discordRoleIds: canEdit ? r.discordRoleIds : undefined,
        })),
        capabilities: perms.CAPABILITIES,
        matrix: perms.getMatrix(),
        defaults: perms.DEFAULTS,
        ownerOnly: perms.OWNER_ONLY,
        ownerRole: perms.OWNER_ROLE,
        maxRoles: perms.MAX_ROLES,
        you: {
            role,
            label: role ? perms.labelOf(role) : null,
            capabilities: role ? perms.capabilitiesOf(role) : [],
            canEdit,
            authDisabled: authDisabled(req),
        },
        // The ranking is not decoration: whoever matches two roles in
        // Discord gets the one nearer the top.
        hint: 'The order of this list is the ranking. Somebody who matches two roles gets the higher one.',
    });
});

// --- The capability matrix -------------------------------------------------
router.put('/api/permissions', (req, res) => {
    if (!guard(req, res)) return;

    const next = req.body?.matrix;
    if (!next || typeof next !== 'object') {
        return res.status(400).json({ error: 'matrix is required' });
    }

    // Every role except owner has to arrive as a list. A missing key would
    // otherwise silently fall back to what is stored and look as if saving
    // had done something other than intended.
    for (const role of perms.listRoles()) {
        if (role.id === perms.OWNER_ROLE) continue;
        if (!Array.isArray(next[role.id])) {
            return res.status(400).json({ error: `matrix.${role.id} must be an array of capability ids` });
        }
        const unknown = next[role.id].filter(id => !perms.CAPABILITY_IDS.includes(id));
        if (unknown.length > 0) {
            return res.status(400).json({ error: `Unknown capabilities: ${unknown.join(', ')}` });
        }
    }

    try {
        const saved = perms.save(next);
        console.log(`[Perms] matrix updated by ${req.user?.username || 'unknown'}`);
        res.json({
            status: 'success',
            message: 'Permissions saved',
            matrix: saved,
            hint: 'Changes apply immediately, nobody has to sign in again.',
        });
    } catch (e) {
        fail(res, e);
    }
});

// --- Roles -----------------------------------------------------------------
// A server with several teams needs more than the four shipped roles, and
// creating one must not mean a redeploy.

router.post('/api/permissions/roles', (req, res) => {
    if (!guard(req, res)) return;

    try {
        const role = perms.createRole({
            id: req.body?.id,
            label: req.body?.label,
            capabilities: req.body?.capabilities,
            copyFrom: req.body?.copyFrom,
            discordUserIds: req.body?.discordUserIds,
            discordRoleIds: req.body?.discordRoleIds,
        });
        console.log(`[Perms] role '${role.id}' created by ${req.user?.username || 'unknown'}`);
        res.status(201).json({
            status: 'success',
            message: `Role '${role.label}' created`,
            role,
            // Saying it plainly beats letting somebody wonder why their new
            // team still cannot sign in.
            hint: role.discordUserIds.length === 0 && role.discordRoleIds.length === 0
                ? 'Nobody is mapped to it yet, so it grants nothing until you add Discord ids or a Discord role.'
                : 'Whoever it names gets it the next time they sign in.',
        });
    } catch (e) {
        fail(res, e);
    }
});

router.patch('/api/permissions/roles/:id', (req, res) => {
    if (!guard(req, res)) return;

    try {
        const role = perms.updateRole(req.params.id, {
            label: req.body?.label,
            capabilities: req.body?.capabilities,
            discordUserIds: req.body?.discordUserIds,
            discordRoleIds: req.body?.discordRoleIds,
        });
        console.log(`[Perms] role '${role.id}' changed by ${req.user?.username || 'unknown'}`);
        res.json({
            status: 'success',
            message: `Role '${role.label}' saved`,
            role,
            hint: role.id === perms.OWNER_ROLE
                ? 'The owner keeps every permission whatever is sent - that is what stops a panel locking its own owner out.'
                : 'Changes apply immediately, nobody has to sign in again.',
        });
    } catch (e) {
        fail(res, e);
    }
});

router.delete('/api/permissions/roles/:id', (req, res) => {
    if (!guard(req, res)) return;

    try {
        const role = perms.getRole(req.params.id);
        const label = role ? role.label : req.params.id;
        const mapped = role ? role.discordUserIds.length + role.discordRoleIds.length : 0;

        perms.deleteRole(req.params.id);
        console.log(`[Perms] role '${req.params.id}' removed by ${req.user?.username || 'unknown'}`);

        res.json({
            status: 'success',
            message: `Role '${label}' removed`,
            // Anyone still signed in under it keeps a session naming a role
            // that no longer exists. can() answers false for that, so they
            // lose access at once rather than keeping it until it expires -
            // but they should be told, not left to discover it.
            hint: mapped > 0
                ? `${mapped} Discord mapping(s) went with it. Anyone who had this role loses access immediately, including sessions already open.`
                : 'Anyone who had this role loses access immediately, including sessions already open.',
        });
    } catch (e) {
        fail(res, e);
    }
});

// The ranking, which decides who wins when somebody matches two roles.
router.put('/api/permissions/roles/order', (req, res) => {
    if (!guard(req, res)) return;

    const order = req.body?.order;
    if (!Array.isArray(order)) {
        return res.status(400).json({ error: 'order must be an array of role ids' });
    }

    try {
        const roles = perms.reorderRoles(order);
        res.json({
            status: 'success',
            message: 'Ranking saved',
            roles: roles.map(r => ({ id: r.id, label: r.label })),
            hint: 'The owner stays at the top whatever order is sent.',
        });
    } catch (e) {
        fail(res, e);
    }
});

module.exports = { router };
