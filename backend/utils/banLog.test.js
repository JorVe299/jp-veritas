// Ban history on a scratch file: kept through lift and expiry, gone only when deleted
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createLog, stateOf, asMergedRow } = require('./banLog');
const { shapeBan, expiryFor } = require('./banlist');

function scratch() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veritas-banlog-'));
    return { file: path.join(dir, 'banlog.json'), dir };
}

const row = (over = {}) => shapeBan({
    id: 7, name: 'Michael Peters', license: 'license:abc', discord: 'discord:123', ip: '',
    reason: 'Cheating', expire: expiryFor(3), bannedby: 'Veritas Panel', ...over,
});

test('an issued ban is found by citizen id and by identifier', () => {
    const { file, dir } = scratch();
    try {
        const log = createLog({ file });
        log.recordIssued(row(), { citizenid: 'GNM6UZLL', by: 'jrdn.' });

        assert.equal(log.forPerson({ citizenid: 'GNM6UZLL' }).length, 1);
        assert.equal(log.forPerson({ identifiers: ['discord:123'] }).length, 1);
        assert.equal(log.forPerson({ identifiers: ['discord:999'] }).length, 0);
        assert.equal(log.forPerson({ citizenid: 'GNM6UZLL' })[0].issuedBy, 'jrdn.');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('lifting marks the entry instead of removing it, and it survives a reload', () => {
    const { file, dir } = scratch();
    try {
        const log = createLog({ file });
        log.recordIssued(row(), { citizenid: 'GNM6UZLL', by: 'jrdn.' });
        log.recordLifted(row(), { by: 'other' });

        const again = createLog({ file }).forPerson({ citizenid: 'GNM6UZLL' });
        assert.equal(again.length, 1);
        assert.equal(again[0].liftedBy, 'other');
        assert.equal(stateOf(again[0], false), 'lifted');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('lifting a ban the panel never issued still leaves an entry', () => {
    const { file, dir } = scratch();
    try {
        const log = createLog({ file });
        log.recordLifted(row({ id: 42 }), { by: 'jrdn.' });
        const [entry] = log.forPerson({ identifiers: ['license:abc'] });
        assert.equal(entry.banId, 42);
        assert.equal(entry.issuedAt, null);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('only delete removes an entry', () => {
    const { file, dir } = scratch();
    try {
        const log = createLog({ file });
        const entry = log.recordIssued(row(), { citizenid: 'GNM6UZLL', by: 'jrdn.' });
        assert.equal(log.remove('nope'), false);
        assert.equal(log.remove(entry.id), true);
        assert.equal(createLog({ file }).all().length, 0);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('an unreadable file is an error, never an empty history that the next write saves', () => {
    const { file, dir } = scratch();
    try {
        fs.writeFileSync(file, '{ not json');
        const log = createLog({ file });
        assert.throws(() => log.recordIssued(row(), { citizenid: 'X', by: 'y' }));
        assert.equal(fs.readFileSync(file, 'utf8'), '{ not json');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('state: row present is in force, past its end is ended, gone otherwise is removed', () => {
    const now = Date.parse('2026-10-07T12:00:00Z');
    const base = { liftedAt: null, permanent: false, expiresAt: '2026-10-10T00:00:00Z' };
    assert.equal(stateOf(base, true, now), 'active');
    assert.equal(stateOf(base, false, now), 'removed');
    assert.equal(stateOf({ ...base, expiresAt: '2026-10-01T00:00:00Z' }, false, now), 'ended');
    assert.equal(stateOf({ ...base, permanent: true, expiresAt: null }, false, now), 'removed');
});

test('as a merged row a history entry is never in force and cannot be lifted', () => {
    const merged = asMergedRow({ id: 'x', banId: 7, state: 'lifted', liftedAt: '2026-10-07T00:00:00Z', identifiers: [] });
    assert.equal(merged.active, false);
    assert.equal(merged.revoked, true);
    assert.equal(merged.canLift, false);
    assert.equal(merged.source, 'history');
});
