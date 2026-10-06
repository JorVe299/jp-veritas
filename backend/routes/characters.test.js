// Character delete against a stand-in DB and bridge: nothing is handed off on an unknown status
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const express = require('express');

function stub(relative, exports) {
    const file = require.resolve(path.join(__dirname, relative));
    require.cache[file] = { id: file, filename: file, loaded: true, exports };
}

// Per-test world; reset() before each case
const world = {};
function reset(overrides = {}) {
    Object.assign(world, {
        rows: new Set(['ABC123']),
        reachable: true,
        online: {},
        framework: 'qb',
        deletesRow: true,
        handoffs: [],
        ...overrides,
    });
}

stub('../utils/dbHandler', {
    db: {
        async execute(sql, params) {
            if (/^SELECT citizenid FROM players WHERE citizenid = \?$/.test(sql)) {
                return [world.rows.has(params[0]) ? [{ citizenid: params[0] }] : []];
            }
            throw new Error(`unexpected query in this test: ${sql}`);
        },
    },
});

// Never the real bridge: a local FiveM server could delete a real character
stub('../utils/bridge', {
    fetchOnlinePlayers: async () => ({ reachable: world.reachable, online: world.reachable ? world.online : {} }),
    callBridge: async (route, payload) => {
        world.handoffs.push({ route, payload });
        if (world.deletesRow) world.rows.delete(payload.citizenid);
        return { success: true };
    },
});

stub('../utils/framework', {
    profile: async () => world.framework === 'qb'
        ? { id: 'qb', label: 'QBCore / Qbox' }
        : { id: 'esx', label: 'ESX Legacy' },
});

const { router, timing } = require('./characters');
timing.confirmMs = 60;
timing.stepMs = 10;

async function remove(citizenid = 'ABC123') {
    const app = express();
    app.use(express.json());
    app.use(router);

    const server = app.listen(0);
    try {
        const res = await fetch(`http://127.0.0.1:${server.address().port}/api/manage/character/${citizenid}`, {
            method: 'DELETE',
        });
        return { status: res.status, body: await res.json() };
    } finally {
        server.close();
    }
}

test('an offline character is handed to the framework and confirmed gone', async () => {
    reset();
    const res = await remove();
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(world.handoffs, [{ route: '/delete-character', payload: { citizenid: 'ABC123' } }]);
    assert.equal(world.rows.has('ABC123'), false);
});

test('a connected character is refused before the bridge is asked to delete', async () => {
    reset({ online: { ABC123: 7 } });
    const res = await remove();
    assert.equal(res.status, 409);
    assert.deepEqual(world.handoffs, []);
});

test('an unreachable game server is an unknown status, not offline', async () => {
    reset({ reachable: false });
    const res = await remove();
    assert.equal(res.status, 503);
    assert.deepEqual(world.handoffs, []);
});

test('a character that does not exist answers 404', async () => {
    reset();
    const res = await remove('NOPE00');
    assert.equal(res.status, 404);
    assert.deepEqual(world.handoffs, []);
});

test('a framework that never removes the row is not reported as a success', async () => {
    reset({ deletesRow: false });
    const res = await remove();
    assert.equal(res.status, 504);
    assert.equal(world.rows.has('ABC123'), true);
});

test('ESX is refused: there is no core delete to hand off to', async () => {
    reset({ framework: 'esx' });
    const res = await remove();
    assert.equal(res.status, 501);
    assert.deepEqual(world.handoffs, []);
});
