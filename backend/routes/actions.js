// backend/routes/actions.js
// Immediate actions on connected players: kick, revive, heal, teleport,
// notify.
//
// Unlike the rest of the panel there is no database path here. These actions
// concern only the running game session - for an offline player they would
// simply have no target. That is not a gap but an honest picture of what is
// possible.
const express = require('express');
const { db } = require('../utils/dbHandler');
const { isPlayerOnline, callBridge } = require('../utils/bridge');

const router = express.Router();

// Plausible bounds for the GTA V map. Without them a player could be put
// into the void below the world, from which they do not come back.
const COORD_LIMIT = 10000;
const Z_MIN = -500;
const Z_MAX = 2000;

// Every action goes through the same sequence: does the player exist, are
// they connected, did the bridge agree.
async function runLiveAction(res, citizenid, route, payload, successText) {
    if (!citizenid) {
        res.status(400).json({ error: 'citizenid is required' });
        return;
    }

    try {
        const [rows] = await db.execute('SELECT citizenid FROM players WHERE citizenid = ?', [citizenid]);
        if (rows.length === 0) {
            res.status(404).json({ error: 'Player not found' });
            return;
        }

        if (!await isPlayerOnline(citizenid)) {
            res.status(409).json({
                error: 'The player is not connected',
                hint: 'Live actions only work while the player is on the server. Everything else in the panel also works offline.'
            });
            return;
        }

        const answer = await callBridge(route, { citizenid, ...payload });
        res.json({ status: 'success', mode: 'live', message: answer?.msg || successText });
    } catch (e) {
        if (e.bridgeRejected) {
            res.status(502).json({ error: e.message });
            return;
        }
        console.error(`[Actions] ${route} failed:`, e.message);
        res.status(500).json({ error: 'The action could not be carried out' });
    }
}

// --- Kick from the server -------------------------------------------------
router.post('/api/manage/kick', async (req, res) => {
    const { citizenid, reason } = req.body;

    const text = String(reason || '').trim();
    if (text.length < 3 || text.length > 255) {
        return res.status(400).json({ error: 'reason must be 3-255 characters' });
    }

    await runLiveAction(res, citizenid, '/kick-player', { reason: text }, 'Player kicked');
});

// --- Revive ---------------------------------------------------------------
router.post('/api/manage/revive', async (req, res) => {
    await runLiveAction(res, req.body.citizenid, '/revive-player', {}, 'Player revived');
});

// --- Heal (health, armor, needs) ------------------------------------------
router.post('/api/manage/heal', async (req, res) => {
    const { citizenid, armor } = req.body;
    const withArmor = armor !== false; // default: top the armor up as well
    await runLiveAction(res, citizenid, '/heal-player', { armor: withArmor }, 'Player healed');
});

// --- Teleport -------------------------------------------------------------
router.post('/api/manage/teleport', async (req, res) => {
    const { citizenid, x, y, z } = req.body;

    const cx = Number(x);
    const cy = Number(y);
    const cz = Number(z);

    if (![cx, cy, cz].every(Number.isFinite)) {
        return res.status(400).json({ error: 'x, y and z must be numbers' });
    }
    if (Math.abs(cx) > COORD_LIMIT || Math.abs(cy) > COORD_LIMIT) {
        return res.status(400).json({ error: `x and y must be within ±${COORD_LIMIT}` });
    }
    if (cz < Z_MIN || cz > Z_MAX) {
        return res.status(400).json({ error: `z must be between ${Z_MIN} and ${Z_MAX}` });
    }

    await runLiveAction(res, citizenid, '/teleport-player', { x: cx, y: cy, z: cz },
        `Player moved to ${cx.toFixed(1)}, ${cy.toFixed(1)}, ${cz.toFixed(1)}`);
});

// --- Send a message -------------------------------------------------------
router.post('/api/manage/notify', async (req, res) => {
    const { citizenid, message, type } = req.body;

    const text = String(message || '').trim();
    if (text.length < 1 || text.length > 255) {
        return res.status(400).json({ error: 'message must be 1-255 characters' });
    }

    const kind = ['inform', 'success', 'error'].includes(type) ? type : 'inform';
    await runLiveAction(res, citizenid, '/notify-player', { message: text, type: kind }, 'Message sent');
});

// --- Last known position --------------------------------------------------
// Read-only and usable offline as well: says where a player logged out.
router.get('/api/players/:citizenid/position', async (req, res) => {
    try {
        const [rows] = await db.execute(
            'SELECT position, last_logged_out FROM players WHERE citizenid = ?',
            [req.params.citizenid]
        );
        if (rows.length === 0) return res.status(404).json({ error: 'Player not found' });

        const raw = rows[0].position;
        const pos = typeof raw === 'string' ? safeParse(raw) : raw;

        res.json({
            position: pos && Number.isFinite(Number(pos.x))
                ? { x: Number(pos.x), y: Number(pos.y), z: Number(pos.z) }
                : null,
            lastLoggedOut: rows[0].last_logged_out || null,
            online: await isPlayerOnline(req.params.citizenid)
        });
    } catch (e) {
        console.error('[Actions] position read failed:', e.message);
        res.status(500).json({ error: 'Database error while reading the position' });
    }
});

function safeParse(raw) {
    try { return JSON.parse(raw); } catch { return null; }
}

module.exports = { router };
