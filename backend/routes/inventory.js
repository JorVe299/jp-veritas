// backend/routes/inventory.js
// Inventar eines Spielers verwalten.
//
// Zwei Formate im Umlauf, je nachdem welche Inventar-Resource läuft:
//   ox_inventory : Array  -> [{ slot, name, count, metadata }]
//   qb-inventory : Objekt -> { "1": { name, amount, slot, info, ... } }
// Wir erkennen das Format beim Lesen und schreiben im selben Format zurück,
// statt eine Variante zu erzwingen.
const express = require('express');
const fs = require('fs');
const path = require('path');
const { db, parseJSON, updatePlayerColumn } = require('../utils/dbHandler');
const { getItems } = require('../utils/dataLoader');
const { isPlayerOnline, callBridge } = require('../utils/bridge');
const { applyMove } = require('../utils/slots');

const router = express.Router();

const MAX_SLOTS = parseInt(process.env.INVENTORY_SLOTS) || 41;
// ox_inventory rechnet in Gramm, Standard sind 30 kg.
const MAX_WEIGHT = parseInt(process.env.INVENTORY_MAX_WEIGHT) || 30000;

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
            const weight = Number.isFinite(Number(meta?.weight)) ? Number(meta.weight) : 0;
            return {
                ...it,
                label: meta?.label || it.name,
                weight,
                totalWeight: weight * it.amount,
                unique: meta?.unique ?? false,
                // Das Bild kommt aus ox_inventory, falls der Ordner gefunden wurde.
                // Fehlt es, faellt die Oberflaeche auf eine Textkachel zurueck.
                image: hasImage(it.name) ? `/api/items/${encodeURIComponent(it.name)}/image` : null
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

function totalWeight(items) {
    return items.reduce((sum, it) => sum + (Number(it.weight) || 0) * it.amount, 0);
}

// --- Item-Bilder ----------------------------------------------------------
// ox_inventory legt seine Icons unter web/images/<item>.png ab. Wenn der
// Ordner erreichbar ist, sieht das Panel aus wie das Inventar im Spiel.
// Sonst laeuft alles weiter, nur eben ohne Bilder.

function discoverImagePath() {
    if (process.env.ITEM_IMAGE_PATH) return process.env.ITEM_IMAGE_PATH;

    // Aus dem Pfad der eigenen Resource nach oben zum resources-Ordner und
    // dort die Kategorie-Ordner ([ox], [standalone], ...) durchsehen.
    const own = process.env.FIVEM_JSON_PATH;
    if (!own) return null;

    let dir = path.resolve(own);
    for (let up = 0; up < 5; up++) {
        if (path.basename(dir) === 'resources') break;
        const parent = path.dirname(dir);
        if (parent === dir) return null;
        dir = parent;
    }
    if (path.basename(dir) !== 'resources') return null;

    const candidates = [path.join(dir, 'ox_inventory', 'web', 'images')];
    try {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.isDirectory()) {
                candidates.push(path.join(dir, entry.name, 'ox_inventory', 'web', 'images'));
            }
        }
    } catch {
        return null;
    }

    return candidates.find(c => fs.existsSync(c)) || null;
}

const IMAGE_PATH = discoverImagePath();
if (IMAGE_PATH) {
    console.log(`[Inventory] item images from ${IMAGE_PATH}`);
} else {
    console.log('[Inventory] no ox_inventory image folder found - the grid falls back to text tiles');
}

// Der Itemname kommt aus der URL und wird zu einem Dateipfad. Strikte
// Whitelist statt Blacklist: alles andere koennte den Ordner verlassen.
const SAFE_ITEM = /^[a-z0-9_-]{1,64}$/i;

function imageFileFor(name) {
    if (!IMAGE_PATH || !SAFE_ITEM.test(name)) return null;
    for (const ext of ['png', 'webp', 'jpg']) {
        const file = path.join(IMAGE_PATH, `${name}.${ext}`);
        if (fs.existsSync(file)) return file;
    }
    return null;
}

function hasImage(name) {
    return Boolean(imageFileFor(name));
}

router.get('/api/items/:name/image', (req, res) => {
    const file = imageFileFor(req.params.name);
    if (!file) return res.status(404).json({ error: 'No image for this item' });

    // Icons aendern sich praktisch nie und werden pro Kachel geladen.
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.sendFile(file);
});

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

        // Slots umsortieren geht nur offline: solange der Spieler verbunden
        // ist, haelt der Server das Inventar im Speicher und wuerde jede
        // direkte Aenderung an der Datenbank beim Speichern ueberschreiben.
        const online = await isPlayerOnline(req.params.citizenid);

        res.json({
            items,
            format,
            count: items.length,
            maxSlots: MAX_SLOTS,
            totalWeight: totalWeight(items),
            maxWeight: MAX_WEIGHT,
            online,
            canReorder: !online,
            imagesAvailable: Boolean(IMAGE_PATH),
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
// action: 'add' | 'remove' | 'set' | 'move'
router.post('/api/manage/inventory', async (req, res) => {
    const { citizenid, action, item, amount, slot, fromSlot, toSlot } = req.body;

    if (!citizenid) return res.status(400).json({ error: 'citizenid is required' });
    if (!['add', 'remove', 'set', 'move'].includes(action)) {
        return res.status(400).json({ error: "action must be 'add', 'remove', 'set' or 'move'" });
    }

    // --- Verschieben: eigener Zweig, weil es kein Item braucht, sondern zwei Slots
    if (action === 'move') {
        return handleMove(req, res);
    }

    if (!item) return res.status(400).json({ error: 'item is required' });

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
        // er unsere DB-Änderung beim nächsten Speichern
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
            const target = slot != null ? items.find(i => i.slot === Number(slot)) : null;

            if (slot != null && target && target.name !== item) {
                return res.status(409).json({ error: `Slot ${slot} already holds ${target.label}` });
            }

            if (target && !isUnique) {
                target.amount += qty;
            } else if (slot != null && !target) {
                items.push({ slot: Number(slot), name: item, amount: qty, metadata: {} });
            } else {
                // Stapelbare Items auf einen vorhandenen Slot legen, unique nicht
                const existing = isUnique ? null : items.find(i => i.name === item);
                if (existing) {
                    existing.amount += qty;
                } else {
                    const free = firstFreeSlot(items);
                    if (free === null) return res.status(409).json({ error: 'The inventory is full' });
                    items.push({ slot: free, name: item, amount: qty, metadata: {} });
                }
            }
        } else if (action === 'remove') {
            let left = qty;
            // Wenn ein Slot genannt ist, nur aus diesem raeumen
            const pool = slot != null
                ? items.filter(i => i.slot === Number(slot) && i.name === item)
                : items.filter(i => i.name === item);

            for (let i = pool.length - 1; i >= 0 && left > 0; i--) {
                const take = Math.min(pool[i].amount, left);
                pool[i].amount -= take;
                left -= take;
            }
            if (left > 0) {
                return res.status(409).json({ error: `The player only owns ${qty - left}x ${item}` });
            }
            // Leergeraeumte Slots entfernen
            for (let i = items.length - 1; i >= 0; i--) {
                if (items[i].amount <= 0) items.splice(i, 1);
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
                const free = slot != null ? Number(slot) : firstFreeSlot(items);
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
            items: updated,
            totalWeight: totalWeight(updated)
        });
    } catch (e) {
        if (e.bridgeRejected) return res.status(502).json({ error: e.message });
        console.error('[Inventory] change failed:', e.message);
        res.status(500).json({ error: 'Error while changing the inventory' });
    }
});

// --- Slots verschieben, tauschen, stapeln ---------------------------------
// Nur offline. Bei einem verbundenen Spieler liegt das Inventar im Speicher
// des Servers; eine Slot-Aenderung in der Datenbank waere beim naechsten
// Speichern weg - im schlimmsten Fall mitsamt der verschobenen Items.
async function handleMove(req, res) {
    const { citizenid, fromSlot, toSlot, amount } = req.body;

    const from = Number(fromSlot);
    const to = Number(toSlot);

    if (!Number.isInteger(from) || !Number.isInteger(to)) {
        return res.status(400).json({ error: 'fromSlot and toSlot must be whole numbers' });
    }
    if (from === to) return res.status(400).json({ error: 'fromSlot and toSlot are the same' });
    if (to < 1 || to > MAX_SLOTS) {
        return res.status(400).json({ error: `toSlot must be between 1 and ${MAX_SLOTS}` });
    }

    try {
        if (await isPlayerOnline(citizenid)) {
            return res.status(409).json({
                error: 'Slots cannot be rearranged while the player is online',
                hint: 'The server holds the live inventory. Adding and removing still works; reordering needs the player to be offline.'
            });
        }

        const [rows] = await db.execute('SELECT inventory FROM players WHERE citizenid = ?', [citizenid]);
        if (rows.length === 0) return res.status(404).json({ error: 'Player not found' });

        const raw = parseJSON(rows[0].inventory);
        const { format, items } = normalize(raw);

        // Die eigentliche Slot-Arithmetik liegt in utils/slots.js und ist
        // dort ohne Datenbank getestet.
        const result = applyMove(items, from, to, amount);
        if (!result.ok) return res.status(result.status).json({ error: result.error });

        const moved = result.items;
        const partial = result.partial;

        await updatePlayerColumn(citizenid, 'inventory', denormalize(moved, format));
        const { items: updated } = normalize(denormalize(moved, format));

        res.json({
            status: 'success',
            mode: 'offline',
            message: partial
                ? `Moved ${result.amount}x ${result.name} to slot ${to}`
                : `Slot ${from} moved to ${to}`,
            items: updated,
            totalWeight: totalWeight(updated)
        });
    } catch (e) {
        console.error('[Inventory] move failed:', e.message);
        res.status(500).json({ error: 'Error while moving the item' });
    }
}

module.exports = { router };
