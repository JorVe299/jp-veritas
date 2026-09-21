// backend/utils/slots.test.js
// Runs with `npm test` (node --test). No database, no fixtures.
const test = require('node:test');
const assert = require('node:assert');
const { applyMove } = require('./slots');

const water = (slot, amount) => ({ slot, name: 'water', amount, label: 'Water', weight: 500, unique: false, metadata: {} });
const bread = (slot, amount) => ({ slot, name: 'bread', amount, label: 'Bread', weight: 300, unique: false, metadata: {} });
const phone = (slot) => ({ slot, name: 'phone', amount: 1, label: 'Phone', weight: 700, unique: true, metadata: {} });

const at = (items, slot) => items.find(i => i.slot === slot);
const total = (items, name) => items.filter(i => i.name === name).reduce((s, i) => s + i.amount, 0);

test('whole stack onto an empty slot: only the slot changes', () => {
    const r = applyMove([water(1, 5)], 1, 9);
    assert.ok(r.ok);
    assert.equal(at(r.items, 1), undefined);
    assert.equal(at(r.items, 9).amount, 5);
    assert.equal(r.partial, false);
});

test('partial stack onto an empty slot: splits off, total stays the same', () => {
    const r = applyMove([water(1, 5)], 1, 9, 2);
    assert.ok(r.ok);
    assert.equal(at(r.items, 1).amount, 3);
    assert.equal(at(r.items, 9).amount, 2);
    assert.equal(total(r.items, 'water'), 5, 'nothing may be created or lost');
    assert.equal(r.partial, true);
});

test('same item: merged, the source disappears', () => {
    const r = applyMove([water(1, 5), water(4, 3)], 1, 4);
    assert.ok(r.ok);
    assert.equal(at(r.items, 1), undefined);
    assert.equal(at(r.items, 4).amount, 8);
    assert.equal(total(r.items, 'water'), 8);
});

test('same item, partial amount: both slots remain', () => {
    const r = applyMove([water(1, 5), water(4, 3)], 1, 4, 2);
    assert.ok(r.ok);
    assert.equal(at(r.items, 1).amount, 3);
    assert.equal(at(r.items, 4).amount, 5);
    assert.equal(total(r.items, 'water'), 8);
});

test('different items: they swap places', () => {
    const r = applyMove([water(1, 5), bread(4, 2)], 1, 4);
    assert.ok(r.ok);
    assert.equal(at(r.items, 1).name, 'bread');
    assert.equal(at(r.items, 4).name, 'water');
    assert.equal(at(r.items, 4).amount, 5);
});

test('partial stack onto an occupied slot with another item: rejected', () => {
    const r = applyMove([water(1, 5), bread(4, 2)], 1, 4, 2);
    assert.equal(r.ok, false);
    assert.equal(r.status, 409);
    assert.match(r.error, /Bread/);
});

test('unique onto unique: swaps, never stacks', () => {
    const r = applyMove([phone(1), phone(4)], 1, 4);
    assert.ok(r.ok);
    assert.equal(at(r.items, 1).amount, 1);
    assert.equal(at(r.items, 4).amount, 1);
    assert.equal(total(r.items, 'phone'), 2, 'unique items must never become a stack');
});

test('empty source slot: 404', () => {
    const r = applyMove([water(1, 5)], 7, 9);
    assert.equal(r.ok, false);
    assert.equal(r.status, 404);
});

test('moving more than is there: 400', () => {
    const r = applyMove([water(1, 5)], 1, 9, 6);
    assert.equal(r.ok, false);
    assert.equal(r.status, 400);
});

test('amount of zero or negative: 400', () => {
    assert.equal(applyMove([water(1, 5)], 1, 9, 0).status, 400);
    assert.equal(applyMove([water(1, 5)], 1, 9, -2).status, 400);
});

test('the input is not mutated', () => {
    const original = [water(1, 5)];
    applyMove(original, 1, 9);
    assert.equal(original[0].slot, 1, 'applyMove must not touch the list it was given');
    assert.equal(original[0].amount, 5);
});
