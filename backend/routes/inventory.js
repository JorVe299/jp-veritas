// Inventory routes; the format is detected on read and kept on write:
//   ox_inventory: [{ slot, name, count, metadata }]
//   qb-inventory: { "1": { name, amount, slot, info } }
const express = require('express');
const fs = require('fs');
const path = require('path');
const { db, parseJSON, updatePlayerColumn } = require('../utils/dbHandler');
const { getItems } = require('../utils/dataLoader');
const { isPlayerOnline, callBridge } = require('../utils/bridge');
const { applyMove } = require('../utils/slots');
const perms = require('../utils/permissions');

const router = express.Router();

// SECURITY: cash is an item on ox_inventory; adding/removing these also needs money.edit
// (moving between slots changes no amount)
const CURRENCY_ITEMS = new Set(['money', 'black_money', 'markedbills']);

const MAX_SLOTS = parseInt(process.env.INVENTORY_SLOTS) || 41;
// Grams (ox_inventory); default 30 kg
const MAX_WEIGHT = parseInt(process.env.INVENTORY_MAX_WEIGHT) || 30000;

function detectFormat(raw) {
    if (Array.isArray(raw)) return 'ox';
    // {} (also a NULL column) is no evidence: 'empty', written as an array (safe on ox_inventory)
    if (raw && typeof raw === 'object') {
        return Object.keys(raw).length === 0 ? 'empty' : 'qb';
    }
    return 'empty';
}

// ox_inventory keeps weapons upper-case (WEAPON_STUNGUN), items lower-case; cores differ
function catalogEntry(catalog, name) {
    const key = String(name ?? '');
    return catalog[key] ?? catalog[key.toLowerCase()] ?? catalog[key.toUpperCase()] ?? null;
}

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
            const meta = catalogEntry(catalog, it.name);
            const weight = Number.isFinite(Number(meta?.weight)) ? Number(meta.weight) : 0;
            return {
                ...it,
                label: meta?.label || it.name,
                weight,
                totalWeight: weight * it.amount,
                unique: meta?.unique ?? false,
                // Only with ox_inventory's image folder; the UI falls back to a text tile
                image: hasImage(it.name) ? `/api/items/${encodeURIComponent(it.name)}/image` : null
            };
        })
        .sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0));

    return { format, items };
}

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
    // ox and 'empty' are written as an array
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

// --- Item images ----------------------------------------------------------
// ox_inventory's web/images/<item>.png if reachable; otherwise text tiles

function discoverImagePath() {
    if (process.env.ITEM_IMAGE_PATH) return process.env.ITEM_IMAGE_PATH;

    // Walk up from FIVEM_JSON_PATH to resources/, then search the [category] folders
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

// SECURITY: absolute root; containment of a served file is asserted against it
const IMAGE_PATH = (() => {
    const found = discoverImagePath();
    return found ? path.resolve(found) : null;
})();
if (IMAGE_PATH) {
    console.log(`[Inventory] item images from ${IMAGE_PATH}`);
} else {
    console.log('[Inventory] no ox_inventory image folder found - the grid falls back to text tiles');
}

// SECURITY: the item name becomes a file path: strict allowlist (no separator, no dot)
const SAFE_ITEM = /^[a-z0-9_-]{1,64}$/i;

// SECURITY: resolved path must stay under IMAGE_PATH; an escape is refused, never trimmed
function underImageRoot(file) {
    const resolved = path.resolve(file);
    return resolved === IMAGE_PATH || resolved.startsWith(IMAGE_PATH + path.sep);
}

function imageFileFor(name) {
    if (!IMAGE_PATH || typeof name !== 'string' || !SAFE_ITEM.test(name)) return null;
    for (const ext of ['png', 'webp', 'jpg']) {
        const file = path.join(IMAGE_PATH, `${name}.${ext}`);
        if (!underImageRoot(file)) return null;
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

    // Icons rarely change; one request per tile
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.sendFile(file);
});

// --- Read the inventory ---------------------------------------------------
router.get('/api/players/:citizenid/inventory', async (req, res) => {
    try {
        const [rows] = await db.execute(
            'SELECT inventory FROM players WHERE citizenid = ?',
            [req.params.citizenid]
        );
        if (rows.length === 0) return res.status(404).json({ error: 'Player not found' });

        const raw = parseJSON(rows[0].inventory);
        const { format, items } = normalize(raw);

        // Online: the server holds the inventory in memory and overwrites DB slot changes on save
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
            // ox_inventory keeps stashes and trunks in their own table
            hint: format === 'ox'
                ? 'ox_inventory detected — showing the carried inventory only, no stashes.'
                : null
        });
    } catch (e) {
        console.error('[Inventory] read failed:', e.message);
        res.status(500).json({ error: 'Database error while loading the inventory' });
    }
});

// --- Change the inventory -------------------------------------------------
// action: 'add' | 'remove' | 'set' | 'move'
router.post('/api/manage/inventory', async (req, res) => {
    const { citizenid, action, item, amount, slot, fromSlot, toSlot } = req.body;

    if (!citizenid) return res.status(400).json({ error: 'citizenid is required' });
    if (!['add', 'remove', 'set', 'move'].includes(action)) {
        return res.status(400).json({ error: "action must be 'add', 'remove', 'set' or 'move'" });
    }

    // move takes two slots, not an item: own handler
    if (action === 'move') {
        return handleMove(req, res);
    }

    if (!item) return res.status(400).json({ error: 'item is required' });

    // SECURITY: money.edit for currency items; no req.user = login disabled (no roles)
    if (CURRENCY_ITEMS.has(String(item).toLowerCase()) && req.user && !perms.can(req.user.role, 'money.edit')) {
        return res.status(403).json({
            error: `'${item}' is money, and changing it needs the permission to change cash and bank balance`,
            required: 'money.edit',
            role: req.user.role,
            hint: 'An owner can grant this in the Permissions card.'
        });
    }

    const qty = Number(amount);
    if (!Number.isInteger(qty) || qty < 0) {
        return res.status(400).json({ error: 'amount must be a whole number >= 0' });
    }

    // Only what is handed out is checked: removing what a player holds never needs the catalog
    // Empty catalog lets it through (resource never ran)
    const catalog = getItems();
    const grows = action === 'add' || (action === 'set' && qty > 0);
    if (grows && Object.keys(catalog).length > 0 && !catalogEntry(catalog, item)) {
        return res.status(404).json({
            error: `Item '${item}' is not in the item catalog`,
            hint: 'Restart the veritas resource so it exports the current item list, then press Reload reference data.',
        });
    }

    try {
        // Online: the core must apply it, else its next save overwrites the DB
        if (await isPlayerOnline(citizenid)) {
            await callBridge('/update-inventory', { citizenid, action, item, amount: qty, slot });
            return res.json({
                status: 'success',
                mode: 'live',
                message: `Inventory updated live (${action} ${qty}x ${item})`
            });
        }

        // Offline: write the DB directly
        const [rows] = await db.execute('SELECT inventory FROM players WHERE citizenid = ?', [citizenid]);
        if (rows.length === 0) return res.status(404).json({ error: 'Player not found' });

        const raw = parseJSON(rows[0].inventory);
        const { format, items } = normalize(raw);
        const isUnique = catalogEntry(catalog, item)?.unique === true;

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
                // Stackable items join an existing slot, unique ones do not
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
            // When a slot is named, only clear that one
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
            // Drop slots that have been emptied
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

// --- Move, swap and stack slots -------------------------------------------
// Offline only: for a connected player a DB slot change is lost on save, possibly with the items
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

        // Slot arithmetic: utils/slots.js (tested without a DB)
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

// Image path resolution exported for the tests
module.exports = { router, imageFileFor };
