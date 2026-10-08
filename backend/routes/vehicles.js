// Vehicle routes (player_vehicles); DB only, even for online players
// Garages read the DB when opened: a bridge path would only add a second, drifting code path
const express = require('express');
const { db, parseJSON, getTableColumns, tableExists, pickExistingColumns } = require('../utils/dbHandler');
const { getVehicles } = require('../utils/dataLoader');

const router = express.Router();
const TABLE = 'player_vehicles';

// SECURITY: spawn-name allowlist; the name reaches the hash loop and the catalog from a body
const SAFE_MODEL = /^[a-z0-9_-]{1,32}$/i;
// Spawn names are at most 23 characters in GTA; the cap only bounds the loop
const MODEL_NAME_MAX = 32;

// GetHashKey(): Jenkins one-at-a-time over the lowercased name; garages need a correct 'hash'
function getHashKey(name) {
    let hash = 0;
    // SECURITY: iteration bounded by a constant, never by the caller's string length
    const s = String(name).toLowerCase().slice(0, MODEL_NAME_MAX);
    for (let i = 0; i < Math.min(s.length, MODEL_NAME_MAX); i++) {
        hash = (hash + s.charCodeAt(i)) >>> 0;
        hash = (hash + (hash << 10)) >>> 0;
        hash = (hash ^ (hash >>> 6)) >>> 0;
    }
    hash = (hash + (hash << 3)) >>> 0;
    hash = (hash ^ (hash >>> 11)) >>> 0;
    hash = (hash + (hash << 15)) >>> 0;
    return hash;
}

// QBCore plates: eight characters, shaped like "ABC 1234"
function generatePlate() {
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const digits = '0123456789';
    const pick = (set, n) => Array.from({ length: n }, () => set[Math.floor(Math.random() * set.length)]).join('');
    return `${pick(letters, 3)} ${pick(digits, 4)}`;
}

// 'mods' holds the ox_lib property table that qbx_garages reads (BACKEND.md §8)
// '{}' crashes garages ("arithmetic on a nil value (field 'engineHealth')"): always set
// this minimal complete set; SetVehicleProperties skips fields not listed
function freshProperties({ model, plate, fuel = 100, engine = 1000, body = 1000 }) {
    return {
        model: getHashKey(model),
        plate,
        plateIndex: 0,
        // 0-1000 game scale; new = undamaged
        engineHealth: engine,
        bodyHealth: body,
        tankHealth: 1000,
        // 0-100; the field the garage crash was about
        fuelLevel: fuel,
        dirtLevel: 0,
    };
}

// Fills gaps only: real values from the world are never reset
function withMissingProperties(existing, row) {
    const base = freshProperties({
        model: row.vehicle,
        plate: row.plate,
        fuel: Number(row.fuel) || 100,
        engine: Number(row.engine) || 1000,
        body: Number(row.body) || 1000,
    });
    const props = (existing && typeof existing === 'object' && !Array.isArray(existing)) ? { ...existing } : {};
    const added = [];
    for (const [key, value] of Object.entries(base)) {
        if (props[key] === undefined || props[key] === null) {
            props[key] = value;
            added.push(key);
        }
    }
    return { props, added };
}

// state: 0 = out, 1 = in the garage, 2 = impounded
const STATE_LABEL = { 0: 'Out', 1: 'In garage', 2: 'Impounded' };

async function ensureTable(res) {
    if (await tableExists(TABLE)) return true;
    res.status(501).json({
        error: `Table '${TABLE}' does not exist in this database`,
        hint: 'Vehicle management expects the standard QBCore/Qbox schema.'
    });
    return false;
}

// --- A player's vehicles --------------------------------------------------
router.get('/api/players/:citizenid/vehicles', async (req, res) => {
    try {
        if (!await ensureTable(res)) return;

        const columns = await getTableColumns(TABLE);
        const [rows] = await db.execute(
            `SELECT * FROM ${TABLE} WHERE citizenid = ? ORDER BY id DESC`,
            [req.params.citizenid]
        );

        const catalog = getVehicles();
        const vehicles = rows.map(row => {
            const model = row.vehicle;
            const meta = catalog[model];
            return {
                id: row.id,
                model,
                // Display name from vehicles.json, else the model
                label: meta?.name || meta?.label || model,
                brand: meta?.brand || null,
                plate: (row.plate || '').trim(),
                garage: row.garage ?? null,
                state: row.state ?? null,
                stateLabel: STATE_LABEL[row.state] ?? 'Unknown',
                fuel: row.fuel ?? null,
                engine: row.engine ?? null,
                body: row.body ?? null,
                mods: columns.includes('mods') ? parseJSON(row.mods) : null
            };
        });

        res.json({ vehicles, count: vehicles.length });
    } catch (e) {
        console.error('[Vehicles] list failed:', e.message);
        res.status(500).json({ error: 'Database error while loading the vehicles' });
    }
});

// --- Add a vehicle --------------------------------------------------------
router.post('/api/manage/vehicle', async (req, res) => {
    const { citizenid, model, plate, garage, state } = req.body;

    if (!citizenid || !model) {
        return res.status(400).json({ error: 'citizenid and model are required' });
    }

    // SECURITY: shape-checked before the catalog, which may be empty and gate nothing
    if (typeof model !== 'string' || !SAFE_MODEL.test(model)) {
        return res.status(400).json({
            error: 'model must be a spawn name: letters, digits, underscore or dash, up to 32 characters'
        });
    }

    // Validate against vehicles.json; an empty catalog (resource never ran) lets it through
    const catalog = getVehicles();
    if (Object.keys(catalog).length > 0 && !catalog[model]) {
        return res.status(404).json({ error: `Vehicle model '${model}' is not listed in vehicles.json` });
    }

    try {
        if (!await ensureTable(res)) return;

        // QBCore keys vehicles on the owner's license
        const [owner] = await db.execute(
            'SELECT license, citizenid FROM players WHERE citizenid = ?',
            [citizenid]
        );
        if (owner.length === 0) return res.status(404).json({ error: 'Player not found' });

        const finalPlate = (plate || generatePlate()).toUpperCase().slice(0, 8);

        // Unique plates: garages mix up duplicates
        const [dupe] = await db.execute(`SELECT id FROM ${TABLE} WHERE plate = ?`, [finalPlate]);
        if (dupe.length > 0) {
            return res.status(409).json({ error: `Plate '${finalPlate}' is already taken` });
        }

        const payload = await pickExistingColumns(TABLE, {
            license: owner[0].license,
            citizenid,
            vehicle: model,
            hash: getHashKey(model),
            // Never '{}': see freshProperties()
            mods: JSON.stringify(freshProperties({ model, plate: finalPlate })),
            plate: finalPlate,
            garage: garage || 'pillboxgarage',
            fuel: 100,
            engine: 1000,
            body: 1000,
            state: Number.isInteger(state) ? state : 1
        });

        const cols = Object.keys(payload);
        const [result] = await db.execute(
            `INSERT INTO ${TABLE} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`,
            Object.values(payload)
        );

        res.json({
            status: 'success',
            message: `${model} added with plate ${finalPlate}`,
            vehicle: { id: result.insertId, model, plate: finalPlate, garage: payload.garage }
        });
    } catch (e) {
        console.error('[Vehicles] create failed:', e.message);
        res.status(500).json({ error: 'Database error while creating', detail: e.code || e.message });
    }
});

// --- Change a vehicle (plate, garage, state) ------------------------------
router.patch('/api/manage/vehicle/:id', async (req, res) => {
    const id = parseInt(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid vehicle ID' });

    const { plate, garage, state } = req.body;
    const changes = {};

    if (plate !== undefined) changes.plate = String(plate).toUpperCase().slice(0, 8);
    if (garage !== undefined) changes.garage = String(garage);
    if (state !== undefined) {
        const s = Number(state);
        if (![0, 1, 2].includes(s)) return res.status(400).json({ error: 'state must be 0, 1 or 2' });
        changes.state = s;
    }

    if (Object.keys(changes).length === 0) {
        return res.status(400).json({ error: 'No change given (plate, garage or state)' });
    }

    try {
        if (!await ensureTable(res)) return;

        if (changes.plate) {
            const [dupe] = await db.execute(
                `SELECT id FROM ${TABLE} WHERE plate = ? AND id <> ?`, [changes.plate, id]
            );
            if (dupe.length > 0) {
                return res.status(409).json({ error: `Plate '${changes.plate}' is already taken` });
            }
        }

        // Plate also lives in the property table: update both, or the car spawns with the old one
        if (changes.plate) {
            const columns = await getTableColumns(TABLE);
            if (columns.includes('mods')) {
                const [current] = await db.execute(
                    'SELECT vehicle, plate, fuel, engine, body, mods FROM ' + TABLE + ' WHERE id = ?',
                    [id]
                );
                if (current.length > 0) {
                    const parsed = parseJSON(current[0].mods);
                    const { props } = withMissingProperties(parsed, { ...current[0], plate: changes.plate });
                    props.plate = changes.plate;
                    changes.mods = JSON.stringify(props);
                }
            }
        }

        const safe = await pickExistingColumns(TABLE, changes);
        const cols = Object.keys(safe);
        if (cols.length === 0) return res.status(400).json({ error: 'None of those columns exist in the table' });

        const [result] = await db.execute(
            `UPDATE ${TABLE} SET ${cols.map(c => `${c} = ?`).join(', ')} WHERE id = ?`,
            [...Object.values(safe), id]
        );

        if (result.affectedRows === 0) return res.status(404).json({ error: 'Vehicle not found' });
        res.json({ status: 'success', message: 'Vehicle updated', changes: safe });
    } catch (e) {
        console.error('[Vehicles] update failed:', e.message);
        res.status(500).json({ error: 'Database error while updating' });
    }
});

// --- Repair the property table of an existing vehicle ---------------------
// Fills missing fields of an incomplete property table; existing values stay
router.post('/api/manage/vehicle/:id/properties', async (req, res) => {
    const id = parseInt(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid vehicle ID' });

    try {
        if (!await ensureTable(res)) return;

        const columns = await getTableColumns(TABLE);
        if (!columns.includes('mods')) {
            return res.status(501).json({
                error: "This table has no 'mods' column",
                hint: 'Vehicle properties are a Qbox/QBCore concept and live in that column.'
            });
        }

        const [rows] = await db.execute(
            'SELECT vehicle, plate, fuel, engine, body, mods FROM ' + TABLE + ' WHERE id = ?',
            [id]
        );
        if (rows.length === 0) return res.status(404).json({ error: 'Vehicle not found' });

        const { props, added } = withMissingProperties(parseJSON(rows[0].mods), rows[0]);

        if (added.length === 0) {
            return res.json({
                status: 'success',
                message: 'Nothing was missing - this vehicle was already complete',
                added: []
            });
        }

        await db.execute('UPDATE ' + TABLE + ' SET mods = ? WHERE id = ?', [JSON.stringify(props), id]);

        console.log('[Vehicles] repaired properties on #' + id + ': ' + added.join(', '));
        res.json({
            status: 'success',
            message: 'Added ' + added.length + ' missing propert' + (added.length === 1 ? 'y' : 'ies'),
            added
        });
    } catch (e) {
        console.error('[Vehicles] property repair failed:', e.message);
        res.status(500).json({ error: 'Database error while repairing the properties' });
    }
});

// --- Delete a vehicle -----------------------------------------------------
router.delete('/api/manage/vehicle/:id', async (req, res) => {
    const id = parseInt(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid vehicle ID' });

    try {
        if (!await ensureTable(res)) return;

        const [result] = await db.execute(`DELETE FROM ${TABLE} WHERE id = ?`, [id]);
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Vehicle not found' });

        res.json({ status: 'success', message: 'Vehicle deleted' });
    } catch (e) {
        console.error('[Vehicles] delete failed:', e.message);
        res.status(500).json({ error: 'Database error while deleting' });
    }
});

// Property helpers exported for the tests
module.exports = { router, getHashKey, generatePlate, freshProperties, withMissingProperties, SAFE_MODEL };
