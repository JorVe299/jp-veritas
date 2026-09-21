// backend/utils/txadmin.test.js
//
// The shaping is where this can quietly go wrong: telling someone a ban is
// over when it is not, or that it stands when it was lifted, is worse than
// showing nothing. So every combination of permanent / expiring / revoked
// is pinned down here, and the file is read end to end against a fixture
// laid out the way txAdmin lays out its own.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// A fixture in txAdmin's own shape: txData/<profile>/data/playersDB.json.
// Built before the module is required, because the path is read once at
// load time - exactly as it is in the running panel.
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'veritas-tx-'));
const DATA_DIR = path.join(ROOT, 'txData', 'default', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const NOW = Math.floor(Date.now() / 1000);
const DAY = 86400;

const FIXTURE = {
    version: 5,
    players: [{ license: 'abc', displayName: 'Someone' }],
    actions: [
        {
            id: 'PERM-0001', type: 'ban',
            ids: ['license:aaa111', 'discord:111111111111111111'],
            reason: 'Cheating', author: 'StaffOne',
            timestamp: NOW - 10 * DAY, expiration: false,
            revocation: { timestamp: null, author: null },
        },
        {
            id: 'OVER-0002', type: 'ban',
            ids: ['discord:111111111111111111'],
            reason: 'Spam', author: 'StaffTwo',
            timestamp: NOW - 30 * DAY, expiration: NOW - 20 * DAY,
            revocation: { timestamp: null, author: null },
        },
        {
            id: 'LIVE-0003', type: 'ban',
            ids: ['license:aaa111'],
            reason: 'RDM', author: 'StaffOne',
            timestamp: NOW - 2 * DAY, expiration: NOW + 5 * DAY,
            revocation: { timestamp: null, author: null },
        },
        {
            id: 'LIFT-0004', type: 'ban',
            ids: ['discord:111111111111111111', 'license:aaa111'],
            reason: 'Mistaken identity', author: 'StaffThree',
            timestamp: NOW - 40 * DAY, expiration: false,
            revocation: { timestamp: NOW - 39 * DAY, author: 'StaffOne' },
        },
        {
            id: 'WARN-0005', type: 'warn',
            ids: ['discord:111111111111111111'],
            reason: 'Language', author: 'StaffTwo',
            timestamp: NOW - DAY, expiration: false,
            revocation: { timestamp: null, author: null },
        },
        {
            id: 'ELSE-0006', type: 'ban',
            ids: ['license:zzz999', 'discord:999999999999999999'],
            reason: 'Someone else entirely', author: 'StaffOne',
            timestamp: NOW - DAY, expiration: false,
            revocation: { timestamp: null, author: null },
        },
    ],
};
fs.writeFileSync(path.join(DATA_DIR, 'playersDB.json'), JSON.stringify(FIXTURE));

process.env.TXADMIN_DB_PATH = path.join(ROOT, 'txData');
const tx = require('./txadmin');
const { asIdentifier } = require('./identity');

const MINE = ['discord:111111111111111111', 'license:aaa111'];

// --- Shaping ---------------------------------------------------------------

test('a permanent ban has no expiry and stands', () => {
    const s = tx.shapeAction(FIXTURE.actions[0], NOW);
    assert.equal(s.permanent, true);
    assert.equal(s.expiresAt, null);
    assert.equal(s.expired, false);
    assert.equal(s.revoked, false);
    assert.equal(s.active, true);
});

test('a ban whose time has run out is over', () => {
    const s = tx.shapeAction(FIXTURE.actions[1], NOW);
    assert.equal(s.permanent, false);
    assert.equal(s.expired, true);
    assert.equal(s.active, false);
    assert.ok(s.expiresAt, 'an expiring ban states when it ran out');
});

test('a ban with time left still stands', () => {
    const s = tx.shapeAction(FIXTURE.actions[2], NOW);
    assert.equal(s.expired, false);
    assert.equal(s.active, true);
});

test('a lifted ban does not stand, permanent or not', () => {
    const s = tx.shapeAction(FIXTURE.actions[3], NOW);
    assert.equal(s.permanent, true);
    assert.equal(s.revoked, true);
    assert.ok(s.revokedAt, 'a lifted ban states when it was lifted');
    assert.equal(s.active, false, 'revocation beats permanence');
});

test('the issuing admin is not handed out by default', () => {
    // The default has to hold here, since the module reads the switch once
    // at load and this suite never sets it.
    assert.equal(tx.SHOW_AUTHOR, false);
    for (const action of FIXTURE.actions) {
        assert.equal('author' in tx.shapeAction(action, NOW), false);
    }
});

test('nothing about the account leaks through the shaping', () => {
    const s = tx.shapeAction(FIXTURE.actions[0], NOW);
    for (const field of ['ids', 'hwids', 'playerName']) {
        assert.equal(field in s, false, `${field} must not reach the player`);
    }
});

test('a missing expiration counts as permanent, not as expired', () => {
    // txAdmin writes `false`, but older rows and hand-edited files have
    // been seen without the key at all. Reading that as "expired at 0"
    // would tell someone a standing ban is over.
    for (const value of [undefined, null, false]) {
        const s = tx.shapeAction({ type: 'ban', timestamp: NOW, expiration: value }, NOW);
        assert.equal(s.permanent, true, `expiration ${String(value)}`);
        assert.equal(s.active, true);
    }
});

// --- Indexing --------------------------------------------------------------

test('one action is found under each of its identifiers', () => {
    const index = tx.buildIndex(FIXTURE.actions);
    assert.equal(index.get('license:aaa111').length, 3);
    assert.equal(index.get('discord:111111111111111111').length, 4);
});

test('identifiers match regardless of case', () => {
    const index = tx.buildIndex([{ type: 'ban', ids: ['License:AAA111'] }]);
    assert.ok(index.get(tx.identifierKey('license:aaa111')));
});

test('malformed entries are skipped rather than thrown on', () => {
    const index = tx.buildIndex([null, 'nonsense', { type: 'ban' }, { type: 'ban', ids: 'x' }]);
    assert.equal(index.size, 0);
});

// --- Reading the file ------------------------------------------------------

test('the history is only what was issued against this account', async () => {
    const r = await tx.actionsFor(MINE);
    assert.equal(r.available, true);
    const ids = r.actions.map(a => a.id);
    assert.deepEqual(ids.includes('ELSE-0006'), false, 'another person\'s ban must not appear');
    assert.deepEqual(new Set(ids), new Set(['PERM-0001', 'OVER-0002', 'LIVE-0003', 'LIFT-0004']));
});

test('an action on two of my identifiers is listed once', () => {
    return tx.actionsFor(MINE).then(r => {
        assert.equal(r.actions.filter(a => a.id === 'LIFT-0004').length, 1);
    });
});

test('warnings are not bans', async () => {
    const bans = await tx.actionsFor(MINE);
    assert.equal(bans.actions.some(a => a.type === 'warn'), false);

    const both = await tx.actionsFor(MINE, { types: ['ban', 'warn'] });
    assert.equal(both.actions.some(a => a.id === 'WARN-0005'), true);
});

test('only the standing ones are counted as standing', async () => {
    const r = await tx.actionsFor(MINE);
    assert.equal(r.count, 4);
    assert.equal(r.activeCount, 2, 'the permanent one and the one with time left');
});

test('the newest ban is first', async () => {
    const r = await tx.actionsFor(MINE);
    const times = r.actions.map(a => Date.parse(a.issuedAt));
    assert.deepEqual(times, [...times].sort((a, b) => b - a));
});

test('an account with no record gets an empty history, not a failure', async () => {
    const r = await tx.actionsFor(['discord:222222222222222222']);
    assert.equal(r.available, true);
    assert.equal(r.count, 0);
});

test('an unreadable store is reported as unavailable, never as a clean record', async () => {
    // The distinction the portal rests on: "nothing on file" and "the file
    // could not be read" must never arrive looking the same.
    const broken = fs.mkdtempSync(path.join(os.tmpdir(), 'veritas-tx-bad-'));
    fs.mkdirSync(path.join(broken, 'txData', 'default', 'data'), { recursive: true });
    fs.writeFileSync(path.join(broken, 'txData', 'default', 'data', 'playersDB.json'), '{ not json');

    // A second instance, so the fixture module keeps its own path.
    delete require.cache[require.resolve('./txadmin')];
    process.env.TXADMIN_DB_PATH = path.join(broken, 'txData');
    const other = require('./txadmin');

    const r = await other.actionsFor(MINE);
    assert.equal(r.available, false);
    assert.match(r.reason, /could not be parsed/i);
    assert.equal('actions' in r, false, 'an unreadable file yields no list at all');

    delete require.cache[require.resolve('./txadmin')];
    process.env.TXADMIN_DB_PATH = path.join(ROOT, 'txData');
});

test('a path that leads nowhere says so and names what it tried', async () => {
    delete require.cache[require.resolve('./txadmin')];
    process.env.TXADMIN_DB_PATH = path.join(ROOT, 'nothing-here');
    const other = require('./txadmin');

    const r = await other.actionsFor(MINE);
    assert.equal(r.available, false);
    assert.match(r.hint, /nothing-here/);

    delete require.cache[require.resolve('./txadmin')];
    process.env.TXADMIN_DB_PATH = path.join(ROOT, 'txData');
});

// --- Identifier notation ---------------------------------------------------

test('a bare column value gains the prefix txAdmin expects', () => {
    assert.equal(asIdentifier('license', 'ABC123'), 'license:abc123');
    assert.equal(asIdentifier('discord', '111111111111111111'), 'discord:111111111111111111');
});

test('an already prefixed value is left as it is', () => {
    assert.equal(asIdentifier('discord', 'discord:111'), 'discord:111');
    // Not re-prefixed into 'license:license:abc', which would match nothing.
    assert.equal(asIdentifier('license', 'license:abc'), 'license:abc');
});

test('an empty column is not an identifier', () => {
    for (const value of ['', '   ', null, undefined]) {
        assert.equal(asIdentifier('license', value), null);
    }
});

test.after(() => {
    fs.rmSync(ROOT, { recursive: true, force: true });
});
