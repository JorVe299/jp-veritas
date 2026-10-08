// The plate stands in for a photo: the same CitizenID must give the same image forever
// Geometry only, no DOM: the invariants the SVG relies on

import { test } from 'vitest';
import assert from 'node:assert/strict';

import { buildPlate, getPlate } from './plate';

test('the same id gives a byte-identical plate', () => {
    assert.deepEqual(buildPlate('GNM6UZLL'), buildPlate('GNM6UZLL'));
    assert.equal(buildPlate('GNM6UZLL').id, buildPlate('GNM6UZLL').id);
});

test('different ids give different plates', () => {
    const a = buildPlate('GNM6UZLL');
    const b = buildPlate('ABC12345');
    assert.notEqual(a.id, b.id);
    assert.notDeepEqual(a, b);
});

test('a missing id is a plate of its own rather than a failure', () => {
    for (const id of [null, undefined, '']) {
        const plate = buildPlate(id);
        assert.deepEqual(plate, buildPlate('unknown'), JSON.stringify(id));
    }
});

test('the shape decides the canvas, and an unknown shape falls back to the poster', () => {
    assert.deepEqual([buildPlate('x').width, buildPlate('x').height], [200, 300]);
    assert.deepEqual([buildPlate('x', 'wide').width, buildPlate('x', 'wide').height], [400, 225]);
    // Unknown shape: poster geometry, but the id keeps the requested shape
    const unknown = buildPlate('x', 'tall');
    assert.deepEqual({ ...unknown, id: null }, { ...buildPlate('x', 'poster'), id: null });
    assert.equal(unknown.id.endsWith('-tall'), true);
});

test('the wide plate is composed separately, not a crop of the poster', () => {
    const poster = buildPlate('GNM6UZLL');
    const wide = buildPlate('GNM6UZLL', 'wide');
    assert.notEqual(poster.id, wide.id);
    assert.equal(wide.viewBox, '0 0 400 225');
    assert.notEqual(poster.ridgeBack, wide.ridgeBack);
});

test('the sky comes from the fixed palette', () => {
    const plate = buildPlate('GNM6UZLL');
    for (const key of ['id', 'zenith', 'horizon', 'light', 'land', 'haze']) {
        assert.equal(typeof plate.sky[key], 'string', key);
    }
    assert.match(plate.sky.zenith, /^#[0-9A-Fa-f]{6}$/);
});

test('across many ids every archetype appears and nothing leaves the canvas', () => {
    const seen = new Set();

    for (let i = 0; i < 400; i += 1) {
        const plate = buildPlate(`CID${i}`);
        seen.add(plate.archetype);

        assert.ok(plate.horizonY > 0 && plate.horizonY < plate.height, `horizon ${plate.horizonY}`);
        assert.ok(plate.light.x > 0 && plate.light.x < plate.width, `light ${plate.light.x}`);
        assert.ok(plate.light.r > 0);
        assert.match(plate.ridgeFront, /^M0 300L0 /);
        assert.ok(plate.palms.length <= 3);
        assert.ok(plate.bands.length >= 2 && plate.bands.length <= 5);
        assert.equal(plate.overhead, plate.archetype === 'overhead');
        assert.equal(plate.towers.length > 0, plate.archetype === 'skyline');
        assert.equal(plate.coast === null, plate.archetype !== 'coast');
    }

    assert.deepEqual([...seen].sort(), ['coast', 'overhead', 'ridges', 'skyline']);
});

test('the overhead archetype keeps its horizon in the upper third', () => {
    for (let i = 0; i < 400; i += 1) {
        const plate = buildPlate(`CID${i}`);
        if (!plate.overhead) continue;
        assert.ok(plate.horizonY < plate.height * 0.37, `horizon ${plate.horizonY}`);
    }
});

// --- Cache ----------------------------------------------------------------

test('the cache hands back the same object for the same id and shape', () => {
    assert.equal(getPlate('GNM6UZLL'), getPlate('GNM6UZLL'));
    assert.notEqual(getPlate('GNM6UZLL'), getPlate('GNM6UZLL', 'wide'));
    assert.deepEqual(getPlate('GNM6UZLL'), buildPlate('GNM6UZLL'));
});

test('the cache stays bounded while a wall pages through citizens', () => {
    for (let i = 0; i < 500; i += 1) getPlate(`PAGE${i}`);
    assert.deepEqual(getPlate('PAGE499'), buildPlate('PAGE499'));
});
