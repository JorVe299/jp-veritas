// Mirror of the store's rules (backend/utils/roleStore.js): what the inline errors may claim
// A pasted Discord name must be refused here; the server would drop it silently

import { test } from 'vitest';
import assert from 'node:assert/strict';

import {
    MAX_LABEL,
    idFromLabel,
    cleanLabel,
    validRoleId,
    isSnowflake,
    roleIdProblem,
    snowflakeProblem,
    sameIds,
} from './roleEditing';

// --- Ids derived from a label ---------------------------------------------

test('a label becomes a lowercase hyphenated id', () => {
    assert.equal(idFromLabel('Head Admin'), 'head-admin');
    assert.equal(idFromLabel('  Support   Team  '), 'support-team');
    assert.equal(idFromLabel('Moderator!!'), 'moderator');
});

test('an id that would not start with a letter gets the role- prefix', () => {
    assert.equal(idFromLabel('123 Crew'), 'role-123-crew');
    assert.equal(idFromLabel(''), 'role-');
    assert.equal(idFromLabel(null), 'role-');
    assert.equal(idFromLabel('!!!'), 'role-');
});

test('a derived id never exceeds 32 characters', () => {
    const long = idFromLabel('a'.repeat(80));
    assert.equal(long.length, 32);
    assert.equal(validRoleId(long), true);

    assert.equal(idFromLabel(`9${'b'.repeat(80)}`).length, 32);
});

test('a label is collapsed and capped, not rejected', () => {
    assert.equal(cleanLabel('  Head   Admin \n'), 'Head Admin');
    assert.equal(cleanLabel(null), '');
    assert.equal(cleanLabel('x'.repeat(MAX_LABEL + 10)).length, MAX_LABEL);
});

// --- Id validation --------------------------------------------------------

test('an empty id is valid input: the server derives it from the label', () => {
    assert.equal(roleIdProblem(''), null);
    assert.equal(roleIdProblem('   '), null);
    assert.equal(roleIdProblem(null), null);
});

test('each bad id gets the message for its own mistake', () => {
    assert.match(roleIdProblem('Admin'), /lowercase/);
    assert.match(roleIdProblem('1admin'), /start with a letter/);
    assert.match(roleIdProblem(`a${'b'.repeat(32)}`), /32 characters/);
    assert.match(roleIdProblem('head admin'), /letters, digits/);
});

test('the accepted id shape matches the store pattern', () => {
    assert.equal(roleIdProblem('head_admin-2'), null);
    assert.equal(validRoleId('head_admin-2'), true);
    assert.equal(validRoleId('Head'), false);
    assert.equal(validRoleId('2head'), false);
    assert.equal(validRoleId(''), false);
    assert.equal(validRoleId(`a${'b'.repeat(32)}`), false);
});

// --- Discord ids ----------------------------------------------------------

test('an empty Discord id asks for a paste rather than reporting a format error', () => {
    assert.match(snowflakeProblem(''), /Paste a Discord id/);
    assert.match(snowflakeProblem('   '), /Paste a Discord id/);
});

test('a pasted name is refused with the Copy ID instruction', () => {
    assert.match(snowflakeProblem('Jordan#1234'), /Copy ID/);
    assert.match(snowflakeProblem('@jordan'), /Digits only/);
    assert.match(snowflakeProblem(' 1234 5678 '), /Digits only/);
});

test('a digit string of the wrong length names its length', () => {
    assert.match(snowflakeProblem('1234'), /has 4/);
    assert.match(snowflakeProblem('1'.repeat(26)), /has 26/);
});

test('a real snowflake passes, surrounding spaces included', () => {
    assert.equal(snowflakeProblem('  123456789012345678  '), null);
    assert.equal(isSnowflake(' 123456789012345678 '), true);
    assert.equal(isSnowflake('1234'), false);
    assert.equal(isSnowflake(null), false);
});

// --- Change detection -----------------------------------------------------

test('two id lists are the same whatever their order', () => {
    assert.equal(sameIds(['a', 'b'], ['b', 'a']), true);
    assert.equal(sameIds([], []), true);
    assert.equal(sameIds(['a'], ['a', 'b']), false);
    assert.equal(sameIds(['a'], ['b']), false);
});

test('a non-array counts as an empty list, so no phantom change is reported', () => {
    assert.equal(sameIds(null, []), true);
    assert.equal(sameIds(undefined, undefined), true);
    assert.equal(sameIds(null, ['a']), false);
});

test('comparing does not reorder the caller\'s arrays', () => {
    const left = ['b', 'a'];
    sameIds(left, ['a', 'b']);
    assert.deepEqual(left, ['b', 'a']);
});
