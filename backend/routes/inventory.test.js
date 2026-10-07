// Inventory writes against a stand-in DB: the catalog gates handing out, never taking away
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const express = require('express');

function stub(relative, exports) {
    const file = require.resolve(path.join(__dirname, relative));
    require.cache[file] = { id: file, filename: file, loaded: true, exports };
}

const world = { inventory: [], catalog: {}, written: null };

stub('../utils/dbHandler', {
    db: {
        async execute(sql) {
            if (/^SELECT inventory FROM players/.test(sql)) {
                return [[{ inventory: JSON.stringify(world.inventory) }]];
            }
            throw new Error(`unexpected query in this test: ${sql}`);
        },
    },
    parseJSON: (v) => (typeof v === 'string' ? JSON.parse(v) : v),
    updatePlayerColumn: async (_cid, _col, value) => { world.written = value; return true; },
});
stub('../utils/dataLoader', { getItems: () => world.catalog });
// Never the real bridge: a local FiveM server could change a real inventory
stub('../utils/bridge', {
    isPlayerOnline: async () => false,
    callBridge: async () => { throw new Error('no bridge in tests'); },
});

const { router } = require('./inventory');

async function change(body) {
    const app = express();
    app.use(express.json());
    app.use(router);
    const server = app.listen(0);
    try {
        const res = await fetch(`http://127.0.0.1:${server.address().port}/api/manage/inventory`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ citizenid: 'ABC123', ...body }),
        });
        return { status: res.status, body: await res.json() };
    } finally {
        server.close();
    }
}

function reset(inventory, catalog) {
    world.inventory = inventory;
    world.catalog = catalog;
    world.written = null;
}

test('a weapon missing from the catalog can still be removed', async () => {
    reset([{ slot: 1, name: 'WEAPON_STUNGUN', count: 1, metadata: {} }], { water: { label: 'Water' } });
    const res = await change({ action: 'set', item: 'WEAPON_STUNGUN', amount: 0 });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(world.written, []);
});

test('remove works for an item the catalog does not know', async () => {
    reset([{ slot: 3, name: 'old_item', count: 2, metadata: {} }], { water: { label: 'Water' } });
    const res = await change({ action: 'remove', item: 'old_item', amount: 2 });
    assert.equal(res.status, 200, JSON.stringify(res.body));
});

test('handing out an unknown item is still refused', async () => {
    reset([], { water: { label: 'Water' } });
    const res = await change({ action: 'add', item: 'made_up', amount: 1 });
    assert.equal(res.status, 404);
    assert.equal(world.written, null);
});

test('the catalog lookup ignores case: ox weapons are upper-case, core lists lower-case', async () => {
    reset([], { weapon_stungun: { label: 'Taser', unique: true } });
    const res = await change({ action: 'add', item: 'WEAPON_STUNGUN', amount: 1 });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.items[0].label, 'Taser');
});
