// Deleting a character: through the framework on the game server, never by SQL here
// The framework knows every table a character spans; a list kept here would drift (BACKEND.md §4)
const express = require('express');
const { db } = require('../utils/dbHandler');
const { fetchOnlinePlayers, callBridge } = require('../utils/bridge');
const { profile } = require('../utils/framework');

const router = express.Router();

// Frameworks delete in a thread and return nothing: confirmed by polling the players row
const timing = { confirmMs: 5000, stepMs: 250 };

async function exists(citizenid) {
    const [rows] = await db.execute('SELECT citizenid FROM players WHERE citizenid = ?', [citizenid]);
    return rows.length > 0;
}

async function gone(citizenid) {
    const until = Date.now() + timing.confirmMs;
    for (;;) {
        if (!await exists(citizenid)) return true;
        if (Date.now() >= until) return false;
        await new Promise(resolve => setTimeout(resolve, timing.stepMs));
    }
}

// Bridge HTTP errors: 401 = token, 404 = resource not restarted since the route was added
function bridgeFailure(e) {
    const status = e.response?.status;
    if (status === 401) {
        return {
            error: e.response.data?.msg || 'The game server refused the token',
            hint: 'Deleting needs the bridge token: set Config.Token in the veritas config.lua '
                + 'and the same value as BRIDGE_TOKEN in backend/.env.',
        };
    }
    if (status === 404) {
        return {
            error: 'The game server does not know this action yet',
            hint: 'Restart the veritas resource so it loads the current bridge.',
        };
    }
    return null;
}

router.delete('/api/manage/character/:citizenid', async (req, res) => {
    const citizenid = String(req.params.citizenid || '').trim();
    if (!citizenid) return res.status(400).json({ error: 'citizenid is missing' });

    try {
        const fw = await profile();
        if (fw.id !== 'qb') {
            return res.status(501).json({
                error: `Deleting characters is not supported on ${fw.label}`,
                hint: 'Only QBCore and Qbox offer a delete the panel can hand the job to.',
            });
        }

        if (!await exists(citizenid)) return res.status(404).json({ error: 'Player not found' });

        // SECURITY: unknown status is not offline; a connected character is saved back on logout
        const bridge = await fetchOnlinePlayers();
        if (!bridge.reachable) {
            return res.status(503).json({
                error: 'The game server cannot be reached, so nothing was deleted',
                hint: 'Deleting runs through the framework on the game server. Try again once it is up.',
            });
        }
        if (bridge.online[citizenid]) {
            return res.status(409).json({
                error: 'The player is connected with this character',
                hint: 'Kick the player first. A character in use would be saved back when they leave.',
            });
        }

        await callBridge('/delete-character', { citizenid });

        if (!await gone(citizenid)) {
            return res.status(504).json({
                error: 'The framework did not confirm the deletion',
                hint: 'The character is still on record. The game server console may say why.',
            });
        }

        res.json({ status: 'success', mode: 'live', message: 'Character deleted', citizenid });
    } catch (e) {
        if (e.bridgeRejected) return res.status(502).json({ error: e.message });
        const failure = bridgeFailure(e);
        if (failure) return res.status(502).json(failure);
        console.error('[Characters] delete failed:', e.message);
        res.status(500).json({ error: 'Error while deleting the character' });
    }
});

module.exports = { router, timing };
