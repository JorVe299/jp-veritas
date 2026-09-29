// Roles and permissions: anyone signed in reads, only the owner writes
// SECURITY: owner check repeated here (guard) on top of enforce(): no single line to trust
const express = require('express');
const perms = require('../utils/permissions');

const router = express.Router();

// Login disabled: no roles, enforce() passes everything, so canEdit must say true as well
const authDisabled = (req) => !req.user;
const mayEdit = (req) => authDisabled(req) || req.user?.role === perms.OWNER_ROLE;

function guard(req, res) {
    if (mayEdit(req)) return true;
    res.status(403).json({ error: 'Only the owner can change roles or permissions' });
    return false;
}

// Store errors carry their status and a hint (e.g. EACCES) for the one person who can fix it
function fail(res, e) {
    const status = Number(e?.status) || 500;
    if (status >= 500) console.error('[Perms] role change failed:', e.message);
    res.status(status).json({ error: e.message, hint: e?.hint || undefined });
}

router.get('/api/permissions', (req, res) => {
    const role = req.user?.role || null;
    const canEdit = mayEdit(req);

    res.json({
        roles: perms.listRoles().map(r => ({
            id: r.id,
            label: r.label,
            capabilityCount: r.capabilities.length,
            // Owner row is visibly locked
            locked: r.id === perms.OWNER_ROLE,
            builtIn: perms.BUILT_IN_ROLES.includes(r.id),
            // SECURITY: Discord id lists only for those who may change them
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
        // Ranking decides between two matching roles
        hint: 'The order of this list is the ranking. Somebody who matches two roles gets the higher one.',
    });
});

// --- The capability matrix ------------------------------------------------
router.put('/api/permissions', (req, res) => {
    if (!guard(req, res)) return;

    const next = req.body?.matrix;
    if (!next || typeof next !== 'object') {
        return res.status(400).json({ error: 'matrix is required' });
    }

    // Every non-owner role must arrive as a list: a missing key would silently keep the old set
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

// --- Roles ----------------------------------------------------------------
// Teams beyond the shipped four, created without a redeploy

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
            // Unmapped roles grant nothing yet: say so
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
            // Open sessions lose access at once (can() is false for a deleted role); tell the owner
            hint: mapped > 0
                ? `${mapped} Discord mapping(s) went with it. Anyone who had this role loses access immediately, including sessions already open.`
                : 'Anyone who had this role loses access immediately, including sessions already open.',
        });
    } catch (e) {
        fail(res, e);
    }
});

// Ranking: decides between two matching roles; owner stays first
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
