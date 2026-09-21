// backend/routes/vehicles.test.js
//
// The 'mods' column holds the ox_lib property table, and a garage does
// arithmetic on its fields. An empty table there is not a cosmetic gap: it
// is the difference between a car that can leave the garage and this,
//
//   attempt to perform arithmetic on a nil value (field 'engineHealth')
//
// so the fields that get divided are pinned down here by name. The second
// half guards the repair: filling gaps must never overwrite the real
// values of a car that has actually been driven.

const test = require('node:test');
const assert = require('node:assert');

const { freshProperties, withMissingProperties, getHashKey } = require('./vehicles');

// The fields qbx_garages divides or displays. Each one nil is a crash.
const ARITHMETIC_FIELDS = ['engineHealth', 'bodyHealth', 'fuelLevel', 'tankHealth'];

// --- What a new vehicle is given ------------------------------------------

test('every field a garage does arithmetic on has a number', () => {
    const props = freshProperties({ model: 'adder', plate: 'ABC 1234' });
    for (const field of ARITHMETIC_FIELDS) {
        assert.equal(typeof props[field], 'number', `${field} must be a number`);
        assert.ok(Number.isFinite(props[field]), `${field} must be finite`);
    }
});

test('no property is left undefined or null', () => {
    const props = freshProperties({ model: 'adder', plate: 'ABC 1234' });
    for (const [key, value] of Object.entries(props)) {
        assert.notEqual(value, undefined, `${key} is undefined`);
        assert.notEqual(value, null, `${key} is null`);
    }
});

test('a new car is undamaged and fuelled', () => {
    const props = freshProperties({ model: 'adder', plate: 'ABC 1234' });
    assert.equal(props.engineHealth, 1000);
    assert.equal(props.bodyHealth, 1000);
    assert.equal(props.tankHealth, 1000);
    assert.equal(props.fuelLevel, 100);
    assert.equal(props.dirtLevel, 0);
});

test('the plate and the model hash are the ones the row carries', () => {
    const props = freshProperties({ model: 'police', plate: 'XYZ 9999' });
    assert.equal(props.plate, 'XYZ 9999');
    // The same hash the 'hash' column gets, or the two disagree about what
    // car this is.
    assert.equal(props.model, getHashKey('police'));
});

test('the table survives a round trip through JSON', () => {
    // It is stored as text in the database, so anything JSON drops here is
    // gone by the time a garage reads it.
    const props = freshProperties({ model: 'adder', plate: 'ABC 1234' });
    const back = JSON.parse(JSON.stringify(props));
    assert.deepEqual(back, props);
});

test('condition passed in from the row is used instead of the defaults', () => {
    const props = freshProperties({ model: 'adder', plate: 'A', fuel: 42, engine: 650, body: 700 });
    assert.equal(props.fuelLevel, 42);
    assert.equal(props.engineHealth, 650);
    assert.equal(props.bodyHealth, 700);
});

// --- Repairing what is already in the database ----------------------------

const ROW = { vehicle: 'adder', plate: 'ABC 1234', fuel: 100, engine: 1000, body: 1000 };

test('an empty table is filled and every addition is named', () => {
    const { props, added } = withMissingProperties({}, ROW);
    for (const field of ARITHMETIC_FIELDS) {
        assert.equal(typeof props[field], 'number');
        assert.ok(added.includes(field), `${field} should be reported as added`);
    }
});

test('real values from a driven car are never flattened', () => {
    // The whole point of a repair that only adds: a wrecked car with an
    // empty tank must not come back from it in factory condition.
    const driven = { engineHealth: 312.5, bodyHealth: 88, fuelLevel: 7.5, dirtLevel: 14 };
    const { props, added } = withMissingProperties(driven, ROW);

    assert.equal(props.engineHealth, 312.5);
    assert.equal(props.bodyHealth, 88);
    assert.equal(props.fuelLevel, 7.5);
    assert.equal(props.dirtLevel, 14);
    assert.equal(added.includes('engineHealth'), false);
    // Only what was genuinely absent is added.
    assert.ok(added.includes('tankHealth'));
});

test('a zero is a value, not a gap', () => {
    // A car with an empty tank reads fuelLevel 0. Treating that as missing
    // would silently refuel it.
    const { props, added } = withMissingProperties({ fuelLevel: 0, bodyHealth: 0 }, ROW);
    assert.equal(props.fuelLevel, 0);
    assert.equal(props.bodyHealth, 0);
    assert.equal(added.includes('fuelLevel'), false);
    assert.equal(added.includes('bodyHealth'), false);
});

test('a null counts as missing', () => {
    const { props, added } = withMissingProperties({ engineHealth: null }, ROW);
    assert.equal(props.engineHealth, 1000);
    assert.ok(added.includes('engineHealth'));
});

test('a column that is not a property table at all is replaced wholesale', () => {
    for (const junk of [null, undefined, 'nonsense', 42, []]) {
        const { props } = withMissingProperties(junk, ROW);
        for (const field of ARITHMETIC_FIELDS) {
            assert.equal(typeof props[field], 'number', `${field} after ${JSON.stringify(junk)}`);
        }
    }
});

test('a complete table is reported as needing nothing', () => {
    const { props } = withMissingProperties({}, ROW);
    const second = withMissingProperties(props, ROW);
    assert.deepEqual(second.added, [], 'repairing twice must be a no-op');
});

test('the repair keeps fields it does not know about', () => {
    // Real property tables carry dozens of mod fields. A repair that
    // dropped them would strip a car of its modifications.
    const { props } = withMissingProperties({ modEngine: 3, neonEnabled: [true, true, true, true] }, ROW);
    assert.equal(props.modEngine, 3);
    assert.deepEqual(props.neonEnabled, [true, true, true, true]);
});

test('the repair takes the plate from the row, not from the old table', () => {
    // A plate change writes the column first; the repair must not put the
    // stale one back.
    const { props } = withMissingProperties({}, { ...ROW, plate: 'NEW 0001' });
    assert.equal(props.plate, 'NEW 0001');
});
