// backend/utils/slots.test.js
// Laeuft mit `npm test` (node --test). Keine Datenbank, keine Fixtures.
const test = require('node:test');
const assert = require('node:assert');
const { applyMove } = require('./slots');

const water = (slot, amount) => ({ slot, name: 'water', amount, label: 'Water', weight: 500, unique: false, metadata: {} });
const bread = (slot, amount) => ({ slot, name: 'bread', amount, label: 'Bread', weight: 300, unique: false, metadata: {} });
const phone = (slot) => ({ slot, name: 'phone', amount: 1, label: 'Phone', weight: 700, unique: true, metadata: {} });

const at = (items, slot) => items.find(i => i.slot === slot);
const total = (items, name) => items.filter(i => i.name === name).reduce((s, i) => s + i.amount, 0);

test('ganzer Stapel auf freien Platz: wechselt nur den Slot', () => {
    const r = applyMove([water(1, 5)], 1, 9);
    assert.ok(r.ok);
    assert.equal(at(r.items, 1), undefined);
    assert.equal(at(r.items, 9).amount, 5);
    assert.equal(r.partial, false);
});

test('Teilstapel auf freien Platz: spaltet ab, Summe bleibt gleich', () => {
    const r = applyMove([water(1, 5)], 1, 9, 2);
    assert.ok(r.ok);
    assert.equal(at(r.items, 1).amount, 3);
    assert.equal(at(r.items, 9).amount, 2);
    assert.equal(total(r.items, 'water'), 5, 'es darf nichts entstehen oder verschwinden');
    assert.equal(r.partial, true);
});

test('gleiches Item: wird zusammengelegt, Quelle verschwindet', () => {
    const r = applyMove([water(1, 5), water(4, 3)], 1, 4);
    assert.ok(r.ok);
    assert.equal(at(r.items, 1), undefined);
    assert.equal(at(r.items, 4).amount, 8);
    assert.equal(total(r.items, 'water'), 8);
});

test('gleiches Item, Teilmenge: beide Slots bleiben bestehen', () => {
    const r = applyMove([water(1, 5), water(4, 3)], 1, 4, 2);
    assert.ok(r.ok);
    assert.equal(at(r.items, 1).amount, 3);
    assert.equal(at(r.items, 4).amount, 5);
    assert.equal(total(r.items, 'water'), 8);
});

test('verschiedene Items: tauschen die Plaetze', () => {
    const r = applyMove([water(1, 5), bread(4, 2)], 1, 4);
    assert.ok(r.ok);
    assert.equal(at(r.items, 1).name, 'bread');
    assert.equal(at(r.items, 4).name, 'water');
    assert.equal(at(r.items, 4).amount, 5);
});

test('Teilstapel auf belegten Platz mit anderem Item: abgelehnt', () => {
    const r = applyMove([water(1, 5), bread(4, 2)], 1, 4, 2);
    assert.equal(r.ok, false);
    assert.equal(r.status, 409);
    assert.match(r.error, /Bread/);
});

test('Einzelstueck auf Einzelstueck: tauscht, stapelt nicht', () => {
    const r = applyMove([phone(1), phone(4)], 1, 4);
    assert.ok(r.ok);
    assert.equal(at(r.items, 1).amount, 1);
    assert.equal(at(r.items, 4).amount, 1);
    assert.equal(total(r.items, 'phone'), 2, 'Einzelstuecke duerfen nie zu einem Stapel werden');
});

test('leerer Quell-Slot: 404', () => {
    const r = applyMove([water(1, 5)], 7, 9);
    assert.equal(r.ok, false);
    assert.equal(r.status, 404);
});

test('mehr verschieben als vorhanden: 400', () => {
    const r = applyMove([water(1, 5)], 1, 9, 6);
    assert.equal(r.ok, false);
    assert.equal(r.status, 400);
});

test('Menge 0 oder negativ: 400', () => {
    assert.equal(applyMove([water(1, 5)], 1, 9, 0).status, 400);
    assert.equal(applyMove([water(1, 5)], 1, 9, -2).status, 400);
});

test('Eingabe wird nicht veraendert', () => {
    const original = [water(1, 5)];
    applyMove(original, 1, 9);
    assert.equal(original[0].slot, 1, 'applyMove darf die uebergebene Liste nicht anfassen');
    assert.equal(original[0].amount, 5);
});
