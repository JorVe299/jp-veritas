// Issuing a ban end to end, against a stand-in DB and bridge (BACKEND.md §8)
// Permanent is the form's default: it must not 500, and must fit the INT(11) `expire` column

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const express = require('express');

// Stand-ins enter the require cache before the route loads its modules
function stub(relative, exports) {
    const file = require.resolve(path.join(__dirname, relative));
    require.cache[file] = { id: file, filename: file, loaded: true, exports };
}

const inserts = [];

stub('../utils/dbHandler', {
    db: {
        async execute(sql, params) {
            if (/^\s*SELECT p\.citizenid/.test(sql)) {
                return [[{
                    citizenid: params[0], name: 'Test Person', username: 'tester',
                    playerLicense: 'license:abc', userLicense: 'license:abc', discord: 'discord:123',
                }]];
            }
            if (/^\s*INSERT INTO bans/.test(sql)) {
                inserts.push({ sql, params });
                return [{ insertId: inserts.length }];
            }
            throw new Error(`unexpected query in this test: ${sql}`);
        },
    },
    tableExists: async () => true,
    pickExistingColumns: async (table, data) => data,
    parseJSON: (value) => value,
    getTableColumns: async () => [],
});

// Never the real bridge: a local FiveM server could be asked about, and kick, a real player
stub('../utils/bridge', {
    isPlayerOnline: async () => false,
    callBridge: async () => { throw new Error('no bridge in tests'); },
});

// Never the real history file: backend/data/banlog.json is runtime state
const logged = [];
stub('../utils/banLog', {
    log: { recordIssued: (ban, meta) => { logged.push({ ban, meta }); } },
});

const { router } = require('./bans');
const banlist = require('../utils/banlist');

// Signed INT(11) maximum
const INT_MAX = 2147483647;

async function ban(body) {
    const app = express();
    app.use(express.json());
    app.use(router);

    const server = app.listen(0);
    try {
        const res = await fetch(`http://127.0.0.1:${server.address().port}/api/manage/ban`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ citizenid: 'ABC123', reason: 'Testing the ban path', ...body }),
        });
        return { status: res.status, body: await res.json() };
    } finally {
        server.close();
    }
}

/** `expire` of the last INSERT, by column name */
function lastWrittenExpire() {
    const { sql, params } = inserts[inserts.length - 1];
    const columns = sql.match(/\(([^)]+)\)/)[1].split(',').map(c => c.trim());
    return params[columns.indexOf('expire')];
}

test('a permanent ban is written rather than refused', async () => {
    const res = await ban({ days: 0 });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.ban.permanent, true);
});

test('a permanent ban fits the INT(11) column it is written to', async () => {
    await ban({ days: 0 });
    const expire = lastWrittenExpire();
    assert.ok(Number.isInteger(expire) && expire <= INT_MAX, `expire ${expire} does not fit a signed INT(11)`);
});

test('what the panel writes as permanent reads back as permanent', async () => {
    await ban({ days: 0 });
    const row = banlist.shapeBan({ id: 1, expire: lastWrittenExpire() });
    assert.equal(row.permanent, true, 'the admin chose permanent, and the list has to say so');
    assert.equal(row.active, true);
});

test('a timed ban reads back as timed and in force', async () => {
    const before = Math.floor(Date.now() / 1000);
    const res = await ban({ days: 7 });
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const expire = lastWrittenExpire();
    assert.ok(expire >= before + 7 * 86400 && expire <= before + 7 * 86400 + 5, `expire ${expire} is not seven days out`);

    const row = banlist.shapeBan({ id: 2, expire });
    assert.equal(row.permanent, false);
    assert.equal(row.active, true);
});

test('the longest timed ban the form offers never overflows the column', () => {
    // Ten years fits today; from 2028 on it would overflow
    assert.ok(banlist.expiryFor(3650) <= INT_MAX);
    const in2030 = Date.UTC(2030, 0, 1) / 1000;
    assert.equal(banlist.expiryFor(3650, in2030), INT_MAX);
});

test('a ban issued in the panel is written to the history', async () => {
    const before = logged.length;
    const res = await ban({ days: 3 });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.history.logged, true);
    assert.equal(logged.length, before + 1);
    assert.equal(logged[logged.length - 1].meta.citizenid, 'ABC123');
    assert.equal(logged[logged.length - 1].ban.reason, 'Testing the ban path');
});

test('the ceiling qb-adminmenu writes for a permanent ban reads as permanent', () => {
    // In-game permanent bans carry the same value: must read as permanent, not as ending in 2038
    assert.equal(banlist.shapeBan({ id: 3, expire: INT_MAX }).permanent, true);
});
