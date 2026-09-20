// backend/routes/inventory.js
// Inventar eines Spielers verwalten.
//
// Zwei Formate im Umlauf, je nachdem welche Inventar-Resource läuft:
//   ox_inventory : Array  -> [{ slot, name, count, metadata }]
//   qb-inventory : Objekt -> { "1": { name, amount, slot, info, ... } }
// Wir erkennen das Format beim Lesen und schreiben im selben Format zurück,
// statt eine Variante zu erzwingen.
const express = require('express');
const { db, parseJSON, updatePlayerColumn } = require('../utils/dbHandler');
const { getItems } = require('../utils/dataLoader');
const { isPlayerOnline, callBridge } = require('../utils/bridge');

const router = express.Router();
const MAX_SLOTS = 41;

function detectFormat(raw) {
    if (Array.isArray(raw)) return 'ox';
    if (raw && typeof raw === 'object') return 'qb';
    return 'empty';
}

// Beide Formate auf eine gemeinsame Darstellung bringen
function normalize(raw) {
    const format = detectFormat(raw);
    const catalog = getItems();

    let entries = [];
    if (format === 'ox') {
        entries = raw.map(it => ({
            slot: it.slot,
            name: it.name,
            amount: it.count ?? it.amount ?? 0,
            metadata: it.metadata ?? it.info ?? null
        }));
    } else if (format === 'qb') {
        entries = Object.values(raw).filter(Boolean).map(it => ({
            slot: it.slot,
            name: it.name,
            amount: it.amount ?? it.count ?? 0,
            metadata: it.info ?? it.metadata ?? null
        }));
    }

    const items = entries
        .filter(it => it.name && it.amount > 0)
        .map(it => {
            const meta = catalog[it.name];
            return {
                ...it,
                label: meta?.label || it.name,
                weight: meta?.weight ?? null,
                unique: meta?.unique ?? false
            };
        })
        .sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0));

    return { format, items };
}

// Zurück ins Originalformat schreiben
function denormalize(items, format) {
    if (format === 'qb') {
        const out = {};
        items.forEach(it => {
            out[String(it.slot)] = {
                name: it.name,
                amount: it.amount,
                slot: it.slot,
                info: it.metadata || {}
            };
        });
        return out;
    }
    // ox und 'empty' schreiben wir als Array
    return items.map(it => ({
        slot: it.slot,
        name: it.name,
        count: it.amount,
        metadata: it.metadata || {}
    }));
}

function firstFreeSlot(items) {
    const used = new Set(items.map(i => i.slot));
    for (let s = 1; s <= MAX_SLOTS; s++) {
        if (!used.has(s)) return s;
    }
    return null;
}

// --- Inventar lesen -------------------------------------------------------
router.get('/api/players/:citizenid/inventory', async (req, res) => {
    try {
        const [rows] = await db.execute(
            'SELECT inventory FROM players WHERE citizenid = ?',
            [req.params.citizenid]
        );
        if (rows.length === 0) return res.status(404).json({ error: 'Player not found' });

        const raw = parseJSON(rows[0].inventory);
        const { format, items } = normalize(raw);

        res.json({
            items,
            format,
            count: items.length,
            maxSlots: MAX_SLOTS,
            // Bei ox_inventory liegen Stashes/Kofferraum in einer eigenen
            // Tabelle - hier sehen wir nur das, was der Spieler am Körper trägt.
            hint: format === 'ox'
                ? 'ox_inventory detected — showing the carried inventory only, no stashes.'
                : null
        });
    } catch (e) {
        console.error('[Inventory] read failed:', e.message);
        res.status(500).json({ error: 'Database error while loading the inventory' });
    }
});

// --- Inventar ändern ------------------------------------------------------
// action: 'add' | 'remove' | 'set'
router.post('/api/manage/inventory', async (req, res) => {
    const { citizenid, action, item, amount, slot } = req.body;

    if (!citizenid || !item) return res.status(400).json({ error: 'citizenid and item are required' });
    if (!['add', 'remove', 'set'].includes(action)) {
        return res.status(400).json({ error: "action must be 'add', 'remove' or 'set'" });
    }

    const qty = Number(amount);
    if (!Number.isInteger(qty) || qty < 0) {
        return res.status(400).json({ error: 'amount must be a whole number >= 0' });
    }

    // Item gegen items.json prüfen. Leerer Katalog -> durchlassen,
    // sonst wäre die Funktion tot, solange die Resource nie lief.
    const catalog = getItems();
    if (Object.keys(catalog).length > 0 && !catalog[item]) {
        return res.status(404).json({ error: `Item '${item}' is not listed in items.json` });
    }

    try {
        // WEG A: Spieler online -> der Core muss es machen, sonst überschreibt
        // er unsere DB-Änderung beim nächsten Speichern wieder
        if (await isPlayerOnline(citizenid)) {
            await callBridge('/update-inventory', { citizenid, action, item, amount: qty, slot });
            return res.json({
                status: 'success',
                mode: 'live',
                message: `Inventory updated live (${action} ${qty}x ${item})`
            });
        }

        // WEG B: Spieler offline -> direkt in der DB
        const [rows] = await db.execute('SELECT inventory FROM players WHERE citizenid = ?', [citizenid]);
        if (rows.length === 0) return res.status(404).json({ error: 'Player not found' });

        const raw = parseJSON(rows[0].inventory);
        const { format, items } = normalize(raw);
        const isUnique = catalog[item]?.unique === true;

        if (action === 'add') {
            // Stapelbare Items auf einen vorhandenen Slot legen, unique nicht
            const existing = isUnique ? null : items.find(i => i.name === item);
            if (existing) {
                existing.amount += qty;
            } else {
                const free = firstFreeSlot(items);
                if (free === null) return res.status(409).json({ error: 'The inventory is full' });
                items.push({ slot: free, name: item, amount: qty, metadata: {} });
            }
        } else if (action === 'remove') {
            let left = qty;
            // Von hinten abräumen, damit Slot-Nummern stabil bleiben
            for (let i = items.length - 1; i >= 0 && left > 0; i--) {
                if (items[i].name !== item) continue;
                const take = Math.min(items[i].amount, left);
                items[i].amount -= take;
                left -= take;
                if (items[i].amount <= 0) items.splice(i, 1);
            }
            if (left > 0) {
                return res.status(409).json({ error: `The player only owns ${qty - left}x ${item}` });
            }
        } else { // set
            const target = slot != null
                ? items.find(i => i.slot === Number(slot) && i.name === item)
                : items.find(i => i.name === item);

            if (qty === 0) {
                const idx = items.indexOf(target);
                if (idx >= 0) items.splice(idx, 1);
            } else if (target) {
                target.amount = qty;
            } else {
                const free = firstFreeSlot(items);
                if (free === null) return res.status(409).json({ error: 'The inventory is full' });
                items.push({ slot: free, name: item, amount: qty, metadata: {} });
            }
        }

        await updatePlayerColumn(citizenid, 'inventory', denormalize(items, format));

        const { items: updated } = normalize(denormalize(items, format));
        res.json({
            status: 'success',
            mode: 'offline',
            message: `Inventory updated in the database (${action} ${qty}x ${item})`,
            items: updated
        });
    } catch (e) {
        if (e.bridgeRejected) return res.status(502).json({ error: e.message });
        console.error('[Inventory] change failed:', e.message);
        res.status(500).json({ error: 'Error while changing the inventory' });
    }
});

module.exports = { router };
