// A missing or malformed capability list must deny, never allow: the locks explain the backend

import { test } from 'vitest';
import assert from 'node:assert/strict';

import { buildPermissions } from './useCan';

test('listed capabilities are granted, unlisted ones are not', () => {
    const { can } = buildPermissions({ capabilities: ['players.view', 'bans.write'] });
    assert.equal(can('players.view'), true);
    assert.equal(can('bans.write'), true);
    assert.equal(can('players.delete'), false);
    assert.equal(can(undefined), false);
});

test('no capability field denies everything', () => {
    for (const user of [null, undefined, {}, { capabilities: null }, { capabilities: 'all' }]) {
        const { can } = buildPermissions(user);
        assert.equal(can('players.view'), false, JSON.stringify(user));
    }
});

test('an empty list denies everything without being treated as missing', () => {
    assert.equal(buildPermissions({ capabilities: [] }).can('players.view'), false);
});

test('non-string entries are dropped instead of granting something', () => {
    const { can } = buildPermissions({ capabilities: ['players.view', null, 7, {}] });
    assert.equal(can('players.view'), true);
    assert.equal(can('7'), false);
});

test('disabled auth allows everything, as the backend then does too', () => {
    const permissions = buildPermissions(null, true);
    assert.equal(permissions.can('anything.at.all'), true);
    assert.equal(permissions.role, null);
    assert.equal(permissions.roleLabel, null);
});

test('the role goes unnamed rather than invented', () => {
    assert.equal(buildPermissions({ capabilities: [], roleLabel: '   ' }).roleLabel, null);
    assert.equal(buildPermissions({ capabilities: [], roleLabel: 7 }).roleLabel, null);
    assert.equal(buildPermissions({ capabilities: [], role: 7 }).role, null);
});

test('role and label come through trimmed', () => {
    const permissions = buildPermissions({ capabilities: [], role: 'admin', roleLabel: '  Head Admin ' });
    assert.equal(permissions.role, 'admin');
    assert.equal(permissions.roleLabel, 'Head Admin');
});
