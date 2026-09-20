// backend/routes/vehicles.js
// Fahrzeuge eines Spielers verwalten (Tabelle player_vehicles).
//
// Fahrzeuge werden bewusst NUR in der Datenbank verändert, auch wenn der
// Spieler online ist: Garagen lesen ihren Bestand beim Öffnen aus der DB.
// Ein Live-Weg über die Bridge brächte hier nichts, würde aber eine zweite
// Codepfad-Variante schaffen, die auseinanderlaufen kann.
const express = require('express');
const { db, parseJSON, getTableColumns, tableExists, pickExistingColumns } = require('../utils/dbHandler');
const { getVehicles } = require('../utils/dataLoader');

const router = express.Router();
const TABLE = 'player_vehicles';

// GTA-Modellhashes sind Jenkins-one-at-a-time über den kleingeschriebenen
// Modellnamen - dieselbe Funktion, die FiveM als GetHashKey() anbietet.
// Die Spalte 'hash' muss stimmen, sonst findet die Garage das Fahrzeug nicht.
function getHashKey(name) {
    let hash = 0;
    const s = String(name).toLowerCase();
    for (let i = 0; i < s.length; i++) {
        hash = (hash + s.charCodeAt(i)) >>> 0;
        hash = (hash + (hash << 10)) >>> 0;
        hash = (hash ^ (hash >>> 6)) >>> 0;
    }
    hash = (hash + (hash << 3)) >>> 0;
    hash = (hash ^ (hash >>> 11)) >>> 0;
    hash = (hash + (hash << 15)) >>> 0;
    return hash;
}

// QBCore-Kennzeichen: 8 Zeichen, Format wie "ABC 1234"
function generatePlate() {
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const digits = '0123456789';
    const pick = (set, n) => Array.from({ length: n }, () => set[Math.floor(Math.random() * set.length)]).join('');
    return `${pick(letters, 3)} ${pick(digits, 4)}`;
}

// state: 0 = draußen, 1 = in der Garage, 2 = beschlagnahmt
const STATE_LABEL = { 0: 'Out', 1: 'In garage', 2: 'Impounded' };

async function ensureTable(res) {
    if (await tableExists(TABLE)) return true;
    res.status(501).json({
        error: `Table '${TABLE}' does not exist in this database`,
        hint: 'Vehicle management expects the standard QBCore/Qbox schema.'
    });
    return false;
}

// --- Liste der Fahrzeuge eines Spielers ----------------------------------
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
                // Aus vehicles.json kommt der schöne Name, sonst bleibt der Modellname
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

// --- Fahrzeug hinzufügen --------------------------------------------------
router.post('/api/manage/vehicle', async (req, res) => {
    const { citizenid, model, plate, garage, state } = req.body;

    if (!citizenid || !model) {
        return res.status(400).json({ error: 'citizenid and model are required' });
    }

    // Modell gegen vehicles.json prüfen, damit kein Tippfehler in der DB landet.
    // Ist der Katalog leer (Resource nie gestartet), lassen wir es durch,
    // statt die Funktion komplett zu blockieren.
    const catalog = getVehicles();
    if (Object.keys(catalog).length > 0 && !catalog[model]) {
        return res.status(404).json({ error: `Vehicle model '${model}' is not listed in vehicles.json` });
    }

    try {
        if (!await ensureTable(res)) return;

        // license des Spielers holen - QBCore hängt Fahrzeuge daran
        const [owner] = await db.execute(
            'SELECT license, citizenid FROM players WHERE citizenid = ?',
            [citizenid]
        );
        if (owner.length === 0) return res.status(404).json({ error: 'Player not found' });

        const finalPlate = (plate || generatePlate()).toUpperCase().slice(0, 8);

        // Kennzeichen müssen eindeutig sein, sonst verwechseln Garagen die Fahrzeuge
        const [dupe] = await db.execute(`SELECT id FROM ${TABLE} WHERE plate = ?`, [finalPlate]);
        if (dupe.length > 0) {
            return res.status(409).json({ error: `Plate '${finalPlate}' is already taken` });
        }

        // Nur Spalten schreiben, die diese Installation wirklich hat
        const payload = await pickExistingColumns(TABLE, {
            license: owner[0].license,
            citizenid,
            vehicle: model,
            hash: getHashKey(model),
            mods: '{}',
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

// --- Fahrzeug ändern (Kennzeichen, Garage, Status) ------------------------
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

// --- Fahrzeug löschen -----------------------------------------------------
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

module.exports = { router, getHashKey, generatePlate };
