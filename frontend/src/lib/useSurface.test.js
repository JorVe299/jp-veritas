// URL reading for the two surfaces; the hooks themselves need a DOM and stay untested
// /identity must not fall into the portal: the match is exact or followed by a slash

import { test } from 'vitest';
import assert from 'node:assert/strict';

import { PORTAL_PATH, surfaceFor, characterIdFor, characterPath } from './useSurface';

test('the portal is /id and whatever sits below it', () => {
    assert.equal(surfaceFor('/id'), 'portal');
    assert.equal(surfaceFor('/id/'), 'portal');
    assert.equal(surfaceFor('/id/GNM6UZLL'), 'portal');
});

test('a path that merely starts with the same letters is the panel', () => {
    for (const path of ['/', '/identity', '/idx', '/players', '/ID', '']) {
        assert.equal(surfaceFor(path), 'panel', JSON.stringify(path));
    }
});

test('a missing path is the panel, not a crash', () => {
    for (const path of [null, undefined, 42, {}]) {
        assert.equal(surfaceFor(path), 'panel', JSON.stringify(path));
    }
});

test('the character id is the first segment under the portal path', () => {
    assert.equal(characterIdFor('/id/GNM6UZLL'), 'GNM6UZLL');
    assert.equal(characterIdFor('/id/GNM6UZLL/'), 'GNM6UZLL');
    assert.equal(characterIdFor('/id/GNM6UZLL/vehicles'), 'GNM6UZLL');
});

test('the portal front door carries no character', () => {
    assert.equal(characterIdFor('/id'), null);
    assert.equal(characterIdFor('/id/'), null);
});

test('no character is read off a panel path', () => {
    assert.equal(characterIdFor('/identity/GNM6UZLL'), null);
    assert.equal(characterIdFor('/'), null);
});

test('an escaped id is decoded, a malformed escape is taken as typed', () => {
    assert.equal(characterIdFor('/id/A%20B'), 'A B');
    assert.equal(characterIdFor('/id/%E2'), '%E2');
});

test('a path is built so that the id survives round-tripping', () => {
    const id = 'A B/C%';
    assert.equal(characterPath(id), '/id/A%20B%2FC%25');
    assert.equal(characterIdFor(characterPath(id)), id);
    assert.equal(characterPath('GNM6UZLL'), `${PORTAL_PATH}/GNM6UZLL`);
});
