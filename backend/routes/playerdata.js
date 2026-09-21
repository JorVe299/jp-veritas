// backend/routes/playerdata.js
// Licences, player condition (hunger/thirst/stress/jail time) and character
// details. All of it lives in JSON columns of the players table.
const express = require('express');
const { db, parseJSON, updatePlayerColumn, getTableColumns } = require('../utils/dbHandler');
const { isPlayerOnline, callBridge } = require('../utils/bridge');

const router = express.Router();

// QBCore writes "licences" (British), some forks "licenses".
// We read both and write back into whichever key is already there.
function licenceKey(metadata) {
    if (metadata && typeof metadata.licenses === 'object' && metadata.licenses !== null) return 'licenses';
    return 'licences';
}

const KNOWN_LICENCES = ['driver', 'business', 'weapon', 'pilot'];

// Numeric condition values an admin may sensibly set, each with its
// permitted range.
const STATUS_FIELDS = {
    hunger: [0, 100],
    thirst: [0, 100],
    stress: [0, 100],
    armor: [0, 100],
    jailtime: [0, 10000],
};

async function loadMetadata(citizenid) {
    const [rows] = await db.execute('SELECT metadata FROM players WHERE citizenid = ?', [citizenid]);
    if (rows.length === 0) return null;
    return parseJSON(rows[0].metadata);
}

// --- Reading --------------------------------------------------------------
router.get('/api/players/:citizenid/metadata', async (req, res) => {
    try {
        const metadata = await loadMetadata(req.params.citizenid);
        if (metadata === null) return res.status(404).json({ error: 'Player not found' });

        const key = licenceKey(metadata);
        const licences = metadata[key] || {};

        res.json({
            licences: KNOWN_LICENCES.reduce((acc, name) => {
                acc[name] = licences[name] === true;
                return acc;
            }, {}),
            licenceKey: key,
            status: Object.keys(STATUS_FIELDS).reduce((acc, field) => {
                acc[field] = metadata[field] ?? null;
                return acc;
            }, {}),
            isdead: metadata.isdead ?? false,
            ishandcuffed: metadata.ishandcuffed ?? false,
            bloodtype: metadata.bloodtype ?? null,
            callsign: metadata.callsign ?? null,
            raw: metadata
        });
    } catch (e) {
        console.error('[Metadata] read failed:', e.message);
        res.status(500).json({ error: 'Database error while loading the metadata' });
    }
});

// --- Set a licence --------------------------------------------------------
router.post('/api/manage/license', async (req, res) => {
    const { citizenid, license, value } = req.body;

    if (!citizenid || !license) return res.status(400).json({ error: 'citizenid and license are required' });
    if (!KNOWN_LICENCES.includes(license)) {
        return res.status(400).json({ error: `license must be one of ${KNOWN_LICENCES.join(', ')}` });
    }
    if (typeof value !== 'boolean') return res.status(400).json({ error: 'value must be true or false' });

    try {
        const metadata = await loadMetadata(citizenid);
        if (metadata === null) return res.status(404).json({ error: 'Player not found' });

        const key = licenceKey(metadata);
        metadata[key] = { ...(metadata[key] || {}), [license]: value };

        // While online the core has to set it, otherwise it overwrites us on save
        if (await isPlayerOnline(citizenid)) {
            await callBridge('/update-metadata', { citizenid, key, value: metadata[key] });
            return res.json({
                status: 'success', mode: 'live',
                message: `Licence '${license}' ${value ? 'granted' : 'revoked'} (live)`,
                licences: metadata[key]
            });
        }

        await updatePlayerColumn(citizenid, 'metadata', metadata);
        res.json({
            status: 'success', mode: 'offline',
            message: `Licence '${license}' ${value ? 'granted' : 'revoked'}`,
            licences: metadata[key]
        });
    } catch (e) {
        if (e.bridgeRejected) return res.status(502).json({ error: e.message });
        console.error('[Metadata] setting licence failed:', e.message);
        res.status(500).json({ error: 'Error while setting the licence' });
    }
});

// --- Set condition (hunger, thirst, stress, armor, jail time) -------------
router.post('/api/manage/status', async (req, res) => {
    const { citizenid, changes } = req.body;

    if (!citizenid || !changes || typeof changes !== 'object') {
        return res.status(400).json({ error: 'citizenid and changes are required' });
    }

    const applied = {};
    for (const [field, value] of Object.entries(changes)) {
        const range = STATUS_FIELDS[field];
        if (!range) return res.status(400).json({ error: `Field '${field}' cannot be changed` });

        const num = Number(value);
        if (!Number.isFinite(num) || num < range[0] || num > range[1]) {
            return res.status(400).json({ error: `${field} must be between ${range[0]} and ${range[1]}` });
        }
        applied[field] = num;
    }

    if (Object.keys(applied).length === 0) {
        return res.status(400).json({ error: 'No valid change given' });
    }

    try {
        const metadata = await loadMetadata(citizenid);
        if (metadata === null) return res.status(404).json({ error: 'Player not found' });

        Object.assign(metadata, applied);

        if (await isPlayerOnline(citizenid)) {
            await callBridge('/update-metadata', { citizenid, fields: applied });
            return res.json({ status: 'success', mode: 'live', message: 'Condition applied live', changes: applied });
        }

        await updatePlayerColumn(citizenid, 'metadata', metadata);
        res.json({ status: 'success', mode: 'offline', message: 'Condition saved', changes: applied });
    } catch (e) {
        if (e.bridgeRejected) return res.status(502).json({ error: e.message });
        console.error('[Metadata] setting condition failed:', e.message);
        res.status(500).json({ error: 'Error while setting the condition' });
    }
});

// --- Change character details (name, phone number) ------------------------
router.post('/api/manage/charinfo', async (req, res) => {
    const { citizenid, firstname, lastname, phone } = req.body;
    if (!citizenid) return res.status(400).json({ error: 'citizenid is missing' });

    const changes = {};
    if (firstname !== undefined) {
        const v = String(firstname).trim();
        if (v.length < 1 || v.length > 50) return res.status(400).json({ error: 'firstname must be 1-50 characters' });
        changes.firstname = v;
    }
    if (lastname !== undefined) {
        const v = String(lastname).trim();
        if (v.length < 1 || v.length > 50) return res.status(400).json({ error: 'lastname must be 1-50 characters' });
        changes.lastname = v;
    }
    if (phone !== undefined) {
        const v = String(phone).trim();
        if (!/^[0-9+\- ]{3,20}$/.test(v)) return res.status(400).json({ error: 'phone contains invalid characters' });
        changes.phone = v;
    }

    if (Object.keys(changes).length === 0) {
        return res.status(400).json({ error: 'No change given (firstname, lastname or phone)' });
    }

    try {
        const [rows] = await db.execute('SELECT charinfo FROM players WHERE citizenid = ?', [citizenid]);
        if (rows.length === 0) return res.status(404).json({ error: 'Player not found' });

        const charinfo = { ...parseJSON(rows[0].charinfo), ...changes };
        await updatePlayerColumn(citizenid, 'charinfo', charinfo);

        // Qbox keeps the number twice: in charinfo.phone and in the
        // phone_number column. Changing only one lets them drift apart.
        if (changes.phone !== undefined) {
            const columns = await getTableColumns('players');
            if (columns.includes('phone_number')) {
                await db.execute('UPDATE players SET phone_number = ? WHERE citizenid = ?', [changes.phone, citizenid]);
            }
        }

        // The core only reads charinfo on load - for a player who is signed
        // in the change takes effect at their next login.
        const online = await isPlayerOnline(citizenid);

        res.json({
            status: 'success',
            mode: 'offline',
            message: 'Character details saved',
            charinfo,
            hint: online
                ? 'The player is online — the change only becomes visible after their next login.'
                : null
        });
    } catch (e) {
        console.error('[Charinfo] change failed:', e.message);
        res.status(500).json({ error: 'Error while saving the character details' });
    }
});

module.exports = { router };
