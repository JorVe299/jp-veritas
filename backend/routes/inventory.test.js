// Inventory writes against a stand-in DB: the catalog gates handing out, never taking away
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
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

// Throwaway image folder; the real one is a FiveM resource path, read before the module loads
const IMAGE_DIR = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'veritas-images-')));
const OUTSIDE_DIR = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'veritas-outside-')));
fs.writeFileSync(path.join(IMAGE_DIR, 'water.png'), 'png');
fs.writeFileSync(path.join(IMAGE_DIR, 'WEAPON_STUNGUN.png'), 'png');
fs.writeFileSync(path.join(OUTSIDE_DIR, 'secret.png'), 'png');
process.env.ITEM_IMAGE_PATH = IMAGE_DIR;

const { router, imageFileFor } = require('./inventory');

test.after(() => {
    fs.rmSync(IMAGE_DIR, { recursive: true, force: true });
    fs.rmSync(OUTSIDE_DIR, { recursive: true, force: true });
});

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

// --- Item image paths -----------------------------------------------------
// SECURITY: the item name becomes a file name; nothing may resolve outside the image folder

async function getImage(encodedName) {
    const app = express();
    app.use(router);
    const server = app.listen(0);
    try {
        const res = await fetch(
            `http://127.0.0.1:${server.address().port}/api/items/${encodedName}/image`
        );
        return res.status;
    } finally {
        server.close();
    }
}

const ESCAPES = [
    '..',
    '../secret',
    String.raw`..\secret`,
    '../../etc/passwd',
    `../${path.basename(OUTSIDE_DIR)}/secret`,
    '/etc/passwd',
    String.raw`C:\Windows\win.ini`,
    'water.png',
    'water%00',
    '....//secret',
    '\u0000water',
    '',
];

test('a plain item name resolves to its image', () => {
    assert.equal(imageFileFor('water'), path.join(IMAGE_DIR, 'water.png'));
});

test('an upper-case weapon name is a legitimate image name', () => {
    // ox_inventory keeps weapons upper-case (BACKEND.md §8)
    assert.equal(imageFileFor('WEAPON_STUNGUN'), path.join(IMAGE_DIR, 'WEAPON_STUNGUN.png'));
});

test('a name that is not a string resolves to nothing', () => {
    for (const junk of [null, undefined, 42, {}, ['water'], { length: 1e9 }]) {
        assert.equal(imageFileFor(junk), null, `${JSON.stringify(junk)} must not resolve`);
    }
});

test('a traversing or absolute item name resolves to nothing', () => {
    for (const name of ESCAPES) {
        assert.equal(imageFileFor(name), null, `${JSON.stringify(name)} must not resolve`);
    }
});

test('every path imageFileFor returns stays inside the image folder', () => {
    // The invariant itself, whichever guard refuses the name
    const names = [...ESCAPES, 'water', 'WEAPON_STUNGUN', 'made_up', 'a-b_c'];
    for (const name of names) {
        const file = imageFileFor(name);
        if (file === null) continue;
        assert.ok(
            file.startsWith(IMAGE_DIR + path.sep),
            `${JSON.stringify(name)} escaped to ${file}`
        );
    }
});

test('the image route answers 404 for a traversing name and 200 for a real item', async () => {
    assert.equal(await getImage(encodeURIComponent('water')), 200);
    assert.equal(await getImage(encodeURIComponent('WEAPON_STUNGUN')), 200);
    for (const name of ['..%2F..%2Fetc%2Fpasswd', '%2Fetc%2Fpasswd', 'water.png', '..%5Csecret']) {
        assert.equal(await getImage(name), 404, `${name} must not be served`);
    }
});
