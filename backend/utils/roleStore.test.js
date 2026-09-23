// backend/utils/roleStore.test.js
//
// Roles are now editable, which means the panel can be asked to change the
// thing that decides who may change it. Three ways that ends badly:
//
//   - the owner role is deleted, renamed away or stripped, and nobody can
//     get back in to undo it
//   - a role is deleted but its permissions outlive it in an open session
//   - the ranking shifts, so somebody who matches two roles silently gets
//     the wrong one
//
// Each is pinned down below, against a scratch file rather than the one a
// live panel keeps its roles in.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createStore, sanitizeState, idFromLabel, cleanIdList } = require('./roleStore');

const CAPS = ['players.view', 'money.edit', 'bans.view', 'bans.edit', 'system.view'];
const DEFAULTS = {
    owner: CAPS.slice(),
    administrator: CAPS.slice(),
    supporter: ['players.view', 'bans.view'],
    citizen: [],
};

let scratchDir;
function freshStore(seed) {
    scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'veritas-roles-'));
    const file = path.join(scratchDir, 'permissions.json');
    if (seed !== undefined) fs.writeFileSync(file, JSON.stringify(seed));
    return createStore({ capabilityIds: CAPS, defaults: DEFAULTS, file });
}

test.afterEach(() => {
    if (scratchDir) fs.rmSync(scratchDir, { recursive: true, force: true });
    scratchDir = null;
});

// --- The owner cannot be locked out ---------------------------------------

test('a fresh installation starts with the shipped roles', () => {
    const store = freshStore();
    assert.deepEqual(store.list().map(r => r.id), ['owner', 'administrator', 'supporter', 'citizen']);
    assert.deepEqual(store.get('supporter').capabilities, ['players.view', 'bans.view']);
});

test('the owner holds every capability, whatever the file says', () => {
    const store = freshStore({ version: 2, roles: [{ id: 'owner', label: 'Owner', capabilities: [] }] });
    assert.deepEqual(store.get('owner').capabilities, CAPS);
});

test('the owner cannot be stripped through an update', () => {
    const store = freshStore();
    store.update('owner', { capabilities: [] });
    assert.deepEqual(store.get('owner').capabilities, CAPS, 'the last key must stay on the last keyring');
});

test('the owner cannot be deleted', () => {
    const store = freshStore();
    assert.throws(() => store.remove('owner'), /cannot be removed/i);
    assert.ok(store.get('owner'));
});

test('a file with no owner at all still produces one', () => {
    const store = freshStore({ version: 2, roles: [{ id: 'support', label: 'Support', capabilities: ['bans.view'] }] });
    assert.ok(store.get('owner'), 'a panel nobody can enter is not a valid state');
    assert.equal(store.list()[0].id, 'owner');
});

test('the owner stays at the top of the ranking', () => {
    const store = freshStore();
    store.create({ label: 'Support Lead' });
    store.reorder(['support-lead', 'citizen', 'owner']);
    assert.equal(store.list()[0].id, 'owner', 'a rank below somebody else is a lockout waiting to happen');
});

test('the owner can still be relabelled', () => {
    // Cosmetic, and harmless: the id is what the code keys on.
    const store = freshStore();
    assert.equal(store.update('owner', { label: 'Founder' }).label, 'Founder');
    assert.equal(store.get('owner').id, 'owner');
});

// --- Creating -------------------------------------------------------------

test('a role can be created and is persisted', () => {
    const store = freshStore();
    const role = store.create({ label: 'Vehicle Team', capabilities: ['players.view'] });

    assert.equal(role.id, 'vehicle-team');
    assert.deepEqual(role.capabilities, ['players.view']);

    store.reset();
    assert.ok(store.get('vehicle-team'), 'it has to survive a reload, not just the request');
});

test('a new role grants nothing until it is told to', () => {
    const store = freshStore();
    assert.deepEqual(store.create({ label: 'Whitelist Crew' }).capabilities, []);
});

test('copying a role takes its permissions but not its identity', () => {
    const store = freshStore();
    const copy = store.create({ label: 'Second Support', copyFrom: 'supporter' });
    assert.deepEqual(copy.capabilities, ['players.view', 'bans.view']);
    assert.deepEqual(copy.discordUserIds, [], 'the people are not copied with the permissions');
});

test('copying the owner cannot produce a second owner', () => {
    // It does copy every capability, and that is fine: handing out
    // permissions is not one of them. OWNER_ONLY is deliberately absent
    // from the capability list, so there is nothing to copy that would let
    // the new role change who may change what.
    const store = freshStore();
    const copy = store.create({ id: 'deputy', label: 'Deputy', copyFrom: 'owner' });

    assert.deepEqual(copy.capabilities, CAPS, 'a copy is a copy');
    assert.notEqual(copy.id, 'owner');
    assert.equal(store.list().filter(r => r.id === 'owner').length, 1);
});

test('two roles cannot share an id', () => {
    const store = freshStore();
    store.create({ label: 'Support Lead' });
    assert.throws(() => store.create({ label: 'Support Lead' }), /already a role/i);
});

test('a role needs a name', () => {
    const store = freshStore();
    assert.throws(() => store.create({ label: '   ' }), /needs a name/i);
});

test('an unusable id is refused rather than mangled', () => {
    const store = freshStore();
    for (const id of ['1team', 'has space', 'ümlaut', 'way-too-long-'.repeat(5)]) {
        assert.throws(() => store.create({ id, label: 'Something' }), /role id/i, `id ${JSON.stringify(id)}`);
    }

    // A single letter is fine, though: a team called 'X' is a real thing
    // to want, and refusing it would be a rule with no reason behind it.
    assert.equal(store.create({ id: 'x', label: 'X Team' }).id, 'x');

    // Case is normalised rather than refused - 'Support' and 'support'
    // are the same role, and telling somebody off for the capital would
    // be a rule with no reason behind it.
    assert.equal(store.create({ id: 'Vehicles', label: 'Vehicles' }).id, 'vehicles');
});

test('a label that is all punctuation still yields a usable id', () => {
    const store = freshStore();
    assert.ok(/^[a-z]/.test(store.create({ label: '★ 24/7 ★' }).id));
});

test('copying a role that is not there says so', () => {
    const store = freshStore();
    assert.throws(() => store.create({ label: 'Anything', copyFrom: 'nope' }), /no role/i);
});

// --- Deleting -------------------------------------------------------------

test('a deleted role grants nothing, immediately', () => {
    const store = freshStore();
    store.create({ label: 'Temp Team', capabilities: ['bans.edit'] });
    store.remove('temp-team');

    assert.equal(store.get('temp-team'), null);
    // The matrix is what can() reads. A permission that outlived its role
    // would be handed to every session still naming it.
    assert.equal('temp-team' in store.matrix(), false);
});

test('deleting a role that is not there says so', () => {
    const store = freshStore();
    assert.throws(() => store.remove('nope'), /no role/i);
});

// --- Discord mapping ------------------------------------------------------

test('only real snowflakes are kept as mappings', () => {
    // A malformed id would match nobody, which looks exactly like a
    // permission that was never granted.
    assert.deepEqual(
        cleanIdList(['123456789012345678', 'not-an-id', '', '42', '  98765432109876543  ']),
        ['123456789012345678', '98765432109876543'],
        "'42' is too short to be a snowflake and is dropped with the rest",
    );
    assert.deepEqual(cleanIdList('123456789012345678, 987654321'), ['123456789012345678', '987654321']);
    assert.deepEqual(cleanIdList(['7777777', '7777777']), ['7777777'], 'duplicates collapse');
});

test('a mapping survives a reload', () => {
    const store = freshStore();
    store.create({ label: 'Support Lead', discordRoleIds: ['123456789012345678'] });
    store.reset();
    assert.deepEqual(store.get('support-lead').discordRoleIds, ['123456789012345678']);
});

// --- The ranking ----------------------------------------------------------

test('the ranking is the list order and it persists', () => {
    const store = freshStore();
    store.reorder(['owner', 'citizen', 'supporter', 'administrator']);
    store.reset();
    assert.deepEqual(store.list().map(r => r.id), ['owner', 'citizen', 'supporter', 'administrator']);
});

test('a role left out of a reorder keeps its place rather than vanishing', () => {
    const store = freshStore();
    store.reorder(['owner', 'citizen']);
    assert.deepEqual(new Set(store.list().map(r => r.id)),
        new Set(['owner', 'administrator', 'supporter', 'citizen']));
});

// --- Upgrading an existing installation -----------------------------------

test('the old file format is read without losing anything', () => {
    // What a panel running since before roles were editable has on disk.
    const store = freshStore({
        owner: CAPS.slice(),
        administrator: ['players.view', 'money.edit'],
        supporter: ['players.view'],
        citizen: [],
    });

    assert.deepEqual(store.list().map(r => r.id), ['owner', 'administrator', 'supporter', 'citizen']);
    assert.deepEqual(store.get('administrator').capabilities, ['players.view', 'money.edit']);
    assert.deepEqual(store.get('supporter').capabilities, ['players.view']);
    assert.equal(store.get('administrator').label, 'Administrator');
});

test('capabilities that no longer exist are dropped, not carried', () => {
    const store = freshStore({ version: 2, roles: [
        { id: 'owner', label: 'Owner', capabilities: [] },
        { id: 'supporter', label: 'Supporter', capabilities: ['players.view', 'resources.exec'] },
    ] });
    assert.deepEqual(store.get('supporter').capabilities, ['players.view'],
        'a removed capability must not read as a granted one');
});

test('a corrupt entry is skipped rather than taking the file down', () => {
    const state = sanitizeState(
        { version: 2, roles: [null, 'nonsense', { label: 'no id' }, { id: 'ok-team', label: 'OK', capabilities: [] }] },
        CAPS, DEFAULTS,
    );
    assert.deepEqual(state.roles.map(r => r.id), ['owner', 'ok-team']);
});

test('the suggested id is derived from the label', () => {
    assert.equal(idFromLabel('Support Lead'), 'support-lead');
    assert.equal(idFromLabel('  Whitelist   Crew  '), 'whitelist-crew');
});

test('two roles cannot share a name either', () => {
    // The ids are what the code keys on; the labels are what a person
    // picks from when granting permissions. Two identical entries in that
    // list is the mistake worth preventing.
    const store = freshStore();
    store.create({ id: 'team-one', label: 'Fleet Team' });
    assert.throws(() => store.create({ id: 'team-two', label: 'fleet team' }), /already a role named/i);
});

test('a rename cannot collide with an existing name', () => {
    const store = freshStore();
    store.create({ id: 'team-one', label: 'Fleet Team' });
    store.create({ id: 'team-two', label: 'Other Team' });
    assert.throws(() => store.update('team-two', { label: 'Fleet Team' }), /already a role named/i);
    assert.equal(store.get('team-two').label, 'Other Team', 'the refused rename changes nothing');
});

test('a role can be renamed to what it already is', () => {
    const store = freshStore();
    store.create({ id: 'team-one', label: 'Fleet Team' });
    assert.equal(store.update('team-one', { label: 'Fleet Team' }).label, 'Fleet Team');
});

// --- The frontend copy of these rules -------------------------------------
// The role editor validates in the field so a pasted username is refused
// where it was typed instead of vanishing on save. That means two copies of
// the same rule, and two copies drift. This does not make the frontend
// authoritative - the store still decides - it just makes a drift fail here
// rather than in somebody's face.

test('the frontend validates role ids by the same rule', () => {
    const mirror = fs.readFileSync(
        path.join(__dirname, '../../frontend/src/lib/roleEditing.js'), 'utf8');
    const source = fs.readFileSync(path.join(__dirname, 'roleStore.js'), 'utf8');

    const ours = source.match(/const ID_PATTERN = (\/.+\/);/);
    const theirs = mirror.match(/const ID_PATTERN = (\/.+\/);/);
    assert.ok(ours && theirs, 'both files should declare ID_PATTERN');
    assert.equal(theirs[1], ours[1], 'the role id rule has drifted apart');
});

test('the frontend validates Discord ids by the same rule', () => {
    const mirror = fs.readFileSync(
        path.join(__dirname, '../../frontend/src/lib/roleEditing.js'), 'utf8');
    const source = fs.readFileSync(path.join(__dirname, 'roleStore.js'), 'utf8');

    const theirs = mirror.match(/const SNOWFLAKE = (\/.+\/);/);
    assert.ok(theirs, 'the editor should declare SNOWFLAKE');
    assert.ok(
        source.includes(theirs[1].slice(1, -1)),
        `the snowflake rule has drifted apart: the editor uses ${theirs[1]}`,
    );
});

// --- A write that cannot land ---------------------------------------------
//
// The panel runs on a machine somebody else set up, and the folder it keeps
// its roles in is not always one it may write to. That case used to end
// badly in a quiet way: the new state was taken into memory and only then
// written, so a refused write left the process holding roles the file knew
// nothing about. The panel showed the change, reported that it had failed,
// and lost it again at the next restart - and the owner was told only
// "The permissions could not be saved", with the reason in a log they were
// not reading.

/** A store whose file can never be written: a file sits where its folder goes. */
function blockedStore() {
    scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'veritas-roles-'));
    fs.writeFileSync(path.join(scratchDir, 'wall'), 'not a folder');
    return createStore({
        capabilityIds: CAPS,
        defaults: DEFAULTS,
        file: path.join(scratchDir, 'wall', 'permissions.json'),
    });
}

test('a refused write leaves the roles exactly as they were', () => {
    const store = blockedStore();
    const before = store.list().map(r => r.id);

    assert.throws(() => store.create({ label: 'Vehicle Crew' }));

    assert.deepEqual(
        store.list().map(r => r.id), before,
        'memory must not hold a role the file was never given',
    );
});

test('a refused reorder leaves the ranking exactly as it was', () => {
    const store = blockedStore();
    const before = store.list().map(r => r.id);

    assert.throws(() => store.reorder(['owner', 'supporter', 'administrator', 'citizen']));

    assert.deepEqual(store.list().map(r => r.id), before);
});

test('a refused write says why, not just that', () => {
    const store = blockedStore();

    try {
        store.create({ label: 'Vehicle Crew' });
        assert.fail('the write should have been refused');
    } catch (e) {
        assert.equal(e.message, 'The permissions could not be saved');
        assert.equal(e.status, 500, 'the route needs a status to answer with');
        assert.ok(e.hint, 'without a reason the owner cannot act on this');
        assert.ok(
            /EEXIST|EACCES|EPERM|ENOTDIR|EROFS|ENOSPC/.test(e.hint),
            `the hint should name the underlying cause, got: ${e.hint}`,
        );
    }
});

test('a write that lands leaves no temporary file behind', () => {
    const store = freshStore();
    store.create({ label: 'Vehicle Crew' });

    assert.deepEqual(
        fs.readdirSync(scratchDir), ['permissions.json'],
        'the file is written beside and renamed into place; nothing else should remain',
    );
});
