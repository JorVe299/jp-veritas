// backend/routes/inventory.js
// Manage a player's inventory.
//
// Two formats are in circulation, depending on the inventory resource:
//   ox_inventory : array  -> [{ slot, name, count, metadata }]
//   qb-inventory : object -> { "1": { name, amount, slot, info, ... } }
// We detect the format while reading and write back in the same one rather
// than forcing a single variant.
const express = require('express');
const fs = require('fs');
const path = require('path');
const { db, parseJSON, updatePlayerColumn } = require('../utils/dbHandler');
const { getItems } = require('../utils/dataLoader');
const { isPlayerOnline, callBridge } = require('../utils/bridge');
const { applyMove } = require('../utils/slots');

const router = express.Router();

const MAX_SLOTS = parseInt(process.env.INVENTORY_SLOTS) || 41;
// ox_inventory counts in grams, the default is 30 kg.
const MAX_WEIGHT = parseInt(process.env.INVENTORY_MAX_WEIGHT) || 30000;

function detectFormat(raw) {
    if (Array.isArray(raw)) return 'ox';
    // An empty object carries no evidence either way, and a NULL column
    // parses to one. Calling that 'qb' would make the first item added to a
    // fresh character get written in the wrong shape on an ox_inventory
    // server - so it counts as 'empty', which is written back as an array.
    if (raw && typeof raw === 'object') {
        return Object.keys(raw).length === 0 ? 'empty' : 'qb';
    }
    return 'empty';
}

// Bring both formats into one common shape
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
                // The image comes from ox_inventory if the folder was found.
                // Without it the UI falls back to a text tile.
                image: hasImage(it.name) ? `/api/items/${encodeURIComponent(it.name)}/image` : null
            };
        })
        .sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0));

    return { format, items };
}

// Write it back in the original format
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
// ox_inventory keeps its icons under web/images/<item>.png. When that
// folder is reachable the panel looks like the inventory in game.
// Otherwise everything keeps working, just without pictures.

function discoverImagePath() {
    if (process.env.ITEM_IMAGE_PATH) return process.env.ITEM_IMAGE_PATH;

    // Walk up from our own resource path to the resources folder and look
    // through the category folders ([ox], [standalone], ...) there.
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

// The item name comes from the URL and becomes a file path. A strict
// whitelist rather than a blacklist: anything else could escape the folder.
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

    // Icons practically never change and are loaded once per tile.
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

        // Reordering slots only works offline: while the player is
        // connected the server holds the inventory in memory and would
        // overwrite any direct database change when it saves.
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
            // With ox_inventory, stashes and trunks live in a table of
            // their own - here we only see what the player carries.
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

    // --- Moving: its own branch, because it needs two slots, not an item
    if (action === 'move') {
        return handleMove(req, res);
    }

    if (!item) return res.status(400).json({ error: 'item is required' });

    const qty = Number(amount);
    if (!Number.isInteger(qty) || qty < 0) {
        return res.status(400).json({ error: 'amount must be a whole number >= 0' });
    }

    // Check the item against items.json. Empty catalog -> let it through,
    // otherwise the feature would be dead until the resource has run once.
    const catalog = getItems();
    if (Object.keys(catalog).length > 0 && !catalog[item]) {
        return res.status(404).json({ error: `Item '${item}' is not listed in items.json` });
    }

    try {
        // PATH A: player online -> the core has to do it, otherwise it
        // overwrites our database change on its next save
        if (await isPlayerOnline(citizenid)) {
            await callBridge('/update-inventory', { citizenid, action, item, amount: qty, slot });
            return res.json({
                status: 'success',
                mode: 'live',
                message: `Inventory updated live (${action} ${qty}x ${item})`
            });
        }

        // PATH B: player offline -> straight into the database
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
// Offline only. For a connected player the inventory lives in the server's
// memory; a slot change in the database would be gone on its next save - in
// the worst case together with the items that were moved.
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

        // The actual slot arithmetic lives in utils/slots.js and is tested
        // there without a database.
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
