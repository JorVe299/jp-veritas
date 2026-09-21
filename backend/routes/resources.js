// backend/routes/resources.js
// Reaching into any resource on the game server.
//
// Three levels, deliberately separated because the risk differs by an order
// of magnitude at each step:
//
//   list     - which resources are running. Harmless.
//   file     - read a file out of a resource. Changes nothing, but a config
//              file can hold secrets, so the bridge keeps an allow list.
//   export   - call an export. Can do whatever the target resource can do.
//              Needs the bridge token AND an allow list entry, and a
//              separate permission in the panel.
//
// The panel does not decide any of that: the bridge holds the allow lists,
// on the game server, where the admin who runs it can see them.
const express = require('express');
const { getBridge, callBridge, fetchStatus, HAS_TOKEN } = require('../utils/bridge');

const router = express.Router();

function bridgeError(res, e, what) {
    if (e.bridgeRejected) {
        return res.status(409).json({ error: e.message, hint: 'The bridge refused. Check Config.AllowedExports / Config.AllowedFiles in the veritas resource.' });
    }
    console.error(`[Resources] ${what} failed:`, e.message);
    res.status(502).json({
        error: 'The FiveM bridge could not be reached',
        detail: e.code || e.message,
    });
}

// --- What does this game server run? --------------------------------------
router.get('/api/resources', async (req, res) => {
    try {
        const data = await getBridge('/resources');
        res.json(data);
    } catch (e) {
        bridgeError(res, e, 'list');
    }
});

// --- Framework and inventory as the bridge sees them ----------------------
router.get('/api/system/framework', async (req, res) => {
    const status = await fetchStatus();

    if (!status.reachable) {
        return res.status(502).json({
            reachable: false,
            error: status.error,
            hint: 'Without the bridge the panel still works from the database, but live actions and the resource browser do not.',
        });
    }

    res.json({
        ...status,
        // Whether the two ends agree about the token, which is the usual
        // reason /export answers 401.
        backendHasToken: HAS_TOKEN,
        tokenMatchLikely: HAS_TOKEN === Boolean(status.tokenConfigured),
    });
});

// --- Read a file out of a resource ----------------------------------------
router.post('/api/resources/file', async (req, res) => {
    const { resource, file } = req.body;

    if (!resource || !file) {
        return res.status(400).json({ error: 'resource and file are required' });
    }

    try {
        const data = await callBridge('/resource-file', { resource, file });
        res.json(data);
    } catch (e) {
        bridgeError(res, e, 'file read');
    }
});

// --- Call an export -------------------------------------------------------
router.post('/api/resources/export', async (req, res) => {
    const { resource, method, args } = req.body;

    if (!resource || !method) {
        return res.status(400).json({ error: 'resource and method are required' });
    }
    if (args !== undefined && !Array.isArray(args)) {
        return res.status(400).json({ error: 'args must be an array' });
    }

    // Saying this here rather than letting the bridge answer 401 turns a
    // confusing rejection into an instruction.
    if (!HAS_TOKEN) {
        return res.status(409).json({
            error: 'No bridge token configured',
            hint: 'Set BRIDGE_TOKEN in the backend .env and the same value as Config.Token in the veritas resource. Calling exports stays closed without it.',
        });
    }

    try {
        const data = await callBridge('/export', { resource, method, args: args || [] });
        res.json(data);
    } catch (e) {
        bridgeError(res, e, 'export call');
    }
});

module.exports = { router };
