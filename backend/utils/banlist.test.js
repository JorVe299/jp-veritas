// backend/utils/banlist.test.js
//
// Merging two ban records is easy to get subtly wrong in ways nobody sees
// until it matters:
//
//   - a txAdmin row that looks liftable, so an admin hunts for a button
//     that cannot exist
//   - a sort that buries the ban actually keeping someone out
//   - a "filter by citizen" that matches the wrong person because an
//     identifier was compared loosely
//
// So the shape, the order and the matching are each pinned down here.

const test = require('node:test');
const assert = require('node:assert');

const banlist = require('./banlist');

// A row of the bans table, already through shapeBan().
const dbBan = (over) => ({
    id: 7, name: 'Jordan', license: 'license:AAA', discord: 'discord:111', ip: '1.2.3.4',
    reason: 'Cheating', bannedBy: 'StaffOne', expire: 0, expiresAt: null,
    permanent: true, active: true, ...over,
});

// A txAdmin action, already through shapeAction().
const txBan = (over) => ({
    id: 'PERM-0001', type: 'ban', playerName: 'Jordan', reason: 'Cheating', author: 'StaffOne',
    identifiers: ['license:aaa', 'discord:111'],
    issuedAt: '2026-09-01T00:00:00.000Z', expiresAt: null,
    permanent: true, revoked: false, revokedAt: null, expired: false, active: true, ...over,
});

// --- Which record a row came from -----------------------------------------

test('only a database row says it can be lifted here', () => {
    assert.equal(banlist.fromDatabase(dbBan()).canLift, true);
    assert.equal(banlist.fromTxAdmin(txBan()).canLift, false);
});

test('every row names its source, and the keys cannot collide', () => {
    const a = banlist.fromDatabase(dbBan({ id: 1 }));
    const b = banlist.fromTxAdmin(txBan({ id: '1' }));
    assert.equal(a.source, 'database');
    assert.equal(b.source, 'txadmin');
    assert.notEqual(a.key, b.key, 'the same native id in both records must stay two rows');
});

test('the bans table is reported as undated rather than given a date', () => {
    // Inventing one from the row id would be a number dressed as a fact.
    const row = banlist.fromDatabase(dbBan());
    assert.equal(row.issuedAt, null);
    assert.equal(row.issuedAtKnown, false);
});

test('a database row is never marked as lifted', () => {
    // That table has no revocation concept - lifting deletes the row - so
    // a row that exists was not lifted, and must not read as though it was.
    assert.equal(banlist.fromDatabase(dbBan({ active: false })).revoked, false);
});

test('database identifiers are normalised the way txAdmin writes them', () => {
    const row = banlist.fromDatabase(dbBan({ license: 'AAA', discord: '111', ip: '1.2.3.4' }));
    assert.deepEqual(row.identifiers, ['license:aaa', 'discord:111', 'ip:1.2.3.4']);
});

test('an identifier column that is empty produces no identifier', () => {
    const row = banlist.fromDatabase(dbBan({ discord: null, ip: '' }));
    assert.deepEqual(row.identifiers, ['license:aaa']);
});

// --- The order --------------------------------------------------------------

test('what is in force comes first, whatever the dates say', () => {
    const over = banlist.fromTxAdmin(txBan({ id: 'B', active: false, expired: true, issuedAt: '2026-09-20T00:00:00.000Z' }));
    const live = banlist.fromTxAdmin(txBan({ id: 'A', active: true, issuedAt: '2026-01-01T00:00:00.000Z' }));

    const sorted = banlist.sortBans([over, live]);
    assert.equal(sorted[0].nativeId, 'A', 'a standing ban outranks a newer spent one');
});

test('inside a group the newest is first', () => {
    const older = banlist.fromTxAdmin(txBan({ id: 'OLD', issuedAt: '2026-01-01T00:00:00.000Z' }));
    const newer = banlist.fromTxAdmin(txBan({ id: 'NEW', issuedAt: '2026-09-01T00:00:00.000Z' }));

    assert.deepEqual(banlist.sortBans([older, newer]).map(r => r.nativeId), ['NEW', 'OLD']);
});

test('undated rows follow the dated ones instead of being scattered', () => {
    const dated = banlist.fromTxAdmin(txBan({ id: 'TX', issuedAt: '2026-01-01T00:00:00.000Z' }));
    const undated = banlist.fromDatabase(dbBan({ id: 3 }));

    const sorted = banlist.sortBans([undated, dated]);
    assert.equal(sorted[0].source, 'txadmin', 'a known date sorts before no date at all');
    assert.equal(sorted[1].source, 'database');
});

test('undated rows fall back to id order among themselves', () => {
    const rows = [1, 9, 4].map(id => banlist.fromDatabase(dbBan({ id })));
    assert.deepEqual(banlist.sortBans(rows).map(r => r.nativeId), [9, 4, 1]);
});

test('the order is total, so a list never reshuffles between requests', () => {
    const rows = [
        banlist.fromDatabase(dbBan({ id: 1, active: false })),
        banlist.fromTxAdmin(txBan({ id: 'X', active: true })),
        banlist.fromDatabase(dbBan({ id: 2, active: true })),
        banlist.fromTxAdmin(txBan({ id: 'Y', active: false, expired: true })),
    ];
    const once = banlist.sortBans(rows).map(r => r.key);
    const again = banlist.sortBans([...rows].reverse()).map(r => r.key);
    assert.deepEqual(again, once, 'the same set must always come back in the same order');
});

test('sorting leaves the caller\'s array alone', () => {
    const rows = [banlist.fromDatabase(dbBan({ id: 1 })), banlist.fromDatabase(dbBan({ id: 2 }))];
    const before = rows.map(r => r.key);
    banlist.sortBans(rows);
    assert.deepEqual(rows.map(r => r.key), before);
});

// --- Finding one person -----------------------------------------------------

test('a citizen matches only on an identifier that is really theirs', () => {
    const row = banlist.fromTxAdmin(txBan({ identifiers: ['license:aaa'] }));
    assert.equal(banlist.belongsTo(row, new Set(['license:aaa'])), true);
    assert.equal(banlist.belongsTo(row, new Set(['license:aab'])), false, 'a near miss is a different person');
    assert.equal(banlist.belongsTo(row, new Set(['aaa'])), false, 'an unprefixed value is not the same key');
});

test('a citizen with no identifiers matches nothing', () => {
    // The honest outcome for a character whose account holds no ids: no
    // ban can be shown to belong to them, and none is.
    const row = banlist.fromTxAdmin(txBan());
    assert.equal(banlist.belongsTo(row, new Set()), false);
    assert.equal(banlist.belongsTo(row, null), false);
});

test('one shared identifier is enough', () => {
    const row = banlist.fromTxAdmin(txBan({ identifiers: ['license:zzz', 'discord:111'] }));
    assert.equal(banlist.belongsTo(row, new Set(['discord:111', 'fivem:9'])), true);
});

// --- Free text --------------------------------------------------------------

test('search reaches the fields a person would type', () => {
    const row = banlist.fromTxAdmin(txBan());
    row.citizenid = 'GNM6UZLL';
    for (const term of ['jordan', 'cheating', 'staffone', 'perm-0001', 'license:aaa', 'gnm6uzll']) {
        assert.equal(banlist.matchesQuery(row, term), true, `should match "${term}"`);
    }
    assert.equal(banlist.matchesQuery(row, 'nothing like this'), false);
});

test('an empty search matches everything rather than nothing', () => {
    assert.equal(banlist.matchesQuery(banlist.fromTxAdmin(txBan()), ''), true);
});

test('search survives a row with holes in it', () => {
    const bare = banlist.fromTxAdmin(txBan({ playerName: null, reason: null, author: null, identifiers: [] }));
    assert.equal(banlist.matchesQuery(bare, 'jordan'), false);
    assert.equal(banlist.matchesQuery(bare, 'perm'), true, 'the action id is still there');
});
