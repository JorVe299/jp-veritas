// backend/routes/permissions.js
// Reading and setting the permission matrix.
//
// Anyone signed in may read it: the frontend needs the list to explain why
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

router.get('/api/permissions', (req, res) => {
    const role = req.user?.role || 'citizen';

    res.json({
        roles: perms.ROLES.map(id => ({
            id,
            label: perms.ROLE_LABELS[id],
            // The owner is not editable - that has to be visible, so that
            // nobody tries in vain to tick boxes there.
            locked: id === 'owner'
        })),
        capabilities: perms.CAPABILITIES,
        matrix: perms.getMatrix(),
        defaults: perms.DEFAULTS,
        ownerOnly: perms.OWNER_ONLY,
        you: {
            role,
            label: perms.ROLE_LABELS[role] || role,
            capabilities: perms.capabilitiesOf(role),
            canEdit: authDisabled(req) || role === 'owner',
            authDisabled: authDisabled(req)
        }
    });
});

router.put('/api/permissions', (req, res) => {
    if (req.user && req.user.role !== 'owner') {
        return res.status(403).json({ error: 'Only the owner can change permissions' });
    }

    const next = req.body?.matrix;
    if (!next || typeof next !== 'object') {
        return res.status(400).json({ error: 'matrix is required' });
    }

    // Every role except owner has to arrive as a list. A missing key would
    // otherwise silently fall back to the default and look as if saving had
    // done something other than intended.
    for (const role of perms.ROLES) {
        if (role === 'owner') continue;
        if (!Array.isArray(next[role])) {
            return res.status(400).json({ error: `matrix.${role} must be an array of capability ids` });
        }
        const unknown = next[role].filter(id => !perms.CAPABILITY_IDS.includes(id));
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
            hint: 'Changes apply immediately, nobody has to sign in again.'
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

module.exports = { router };
