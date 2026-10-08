// One answer per question in the portal: a name, a job line, a gang line, a number
// Nothing is invented for a missing value; the dash is the only stand-in

import { test } from 'vitest';
import assert from 'node:assert/strict';

import {
    DASH,
    shown,
    characterName,
    gradeText,
    jobLine,
    gangLine,
    numberOrNull,
} from './portalText';

test('shown passes text and numbers, everything else becomes the dash', () => {
    assert.equal(shown('Jordan'), 'Jordan');
    assert.equal(shown(0), '0');
    assert.equal(shown(-1.5), '-1.5');
    for (const value of [null, undefined, '', '   ', Number.NaN, {}, []]) {
        assert.equal(shown(value), DASH, JSON.stringify(value));
    }
});

test('shown trims nothing away that a person typed', () => {
    assert.equal(shown('  Jordan  '), 'Jordan');
});

// --- Names ----------------------------------------------------------------

test('the list name wins over the charinfo parts', () => {
    const source = { name: 'Jordan Reed', charinfo: { firstname: 'J', lastname: 'R' } };
    assert.equal(characterName(source), 'Jordan Reed');
});

test('charinfo parts are joined, a missing half does not leave a gap', () => {
    assert.equal(characterName({ charinfo: { firstname: 'Jordan', lastname: 'Reed' } }), 'Jordan Reed');
    assert.equal(characterName({ charinfo: { firstname: 'Jordan' } }), 'Jordan');
    assert.equal(characterName({ charinfo: { lastname: 'Reed' } }), 'Reed');
});

test('the parts are also read off a flat row', () => {
    assert.equal(characterName({ firstname: 'Jordan', lastname: 'Reed' }), 'Jordan Reed');
});

test('a nameless character falls back to the citizen id, never to "Unknown"', () => {
    assert.equal(characterName({ citizenid: 'GNM6UZLL' }), 'GNM6UZLL');
    assert.equal(characterName({ citizenid: 'GNM6UZLL', charinfo: {} }), 'GNM6UZLL');
});

test('no usable source at all gives the dash', () => {
    for (const source of [null, undefined, 'Jordan', 42, {}]) {
        assert.equal(characterName(source), DASH, JSON.stringify(source));
    }
});

// --- Grades, jobs, gangs --------------------------------------------------

test('a grade is read as a number, a name or a framework object', () => {
    assert.equal(gradeText(0), '0');
    assert.equal(gradeText('Chief'), 'Chief');
    assert.equal(gradeText({ name: 'Chief', level: 4 }), 'Chief · 4');
    assert.equal(gradeText({ label: 'Chief' }), 'Chief');
    assert.equal(gradeText({ level: 4 }), '4');
    assert.equal(gradeText({ grade: 2 }), '2');
});

test('an unreadable grade is null, never guessed', () => {
    for (const grade of [null, undefined, '', '  ', {}, { name: '' }, true]) {
        assert.equal(gradeText(grade), null, JSON.stringify(grade));
    }
});

test('a job line names the label, the grade only when there is one', () => {
    assert.equal(jobLine({ label: 'Police', grade: { name: 'Chief' } }), 'Police · Chief');
    assert.equal(jobLine({ label: 'Police' }), 'Police');
    assert.equal(jobLine({ name: 'police' }), 'police');
});

test('a missing or nameless job reads as unemployed', () => {
    for (const job of [null, undefined, {}, { name: '  ' }, 'police']) {
        assert.equal(jobLine(job), 'Unemployed', JSON.stringify(job));
    }
});

test('"none" is the framework\'s empty gang and shows nothing', () => {
    for (const gang of [{ name: 'none' }, { name: 'NONE' }, { label: 'None' }]) {
        assert.equal(gangLine(gang), null, JSON.stringify(gang));
    }
});

test('a real gang reads like a job line', () => {
    assert.equal(gangLine({ label: 'Vagos', grade: { name: 'Boss', level: 3 } }), 'Vagos · Boss · 3');
    assert.equal(gangLine({ name: 'vagos' }), 'vagos');
    assert.equal(gangLine(null), null);
});

// --- Numbers --------------------------------------------------------------

test('an unreadable number stays null while zero stays zero', () => {
    assert.equal(numberOrNull(0), 0);
    assert.equal(numberOrNull('0'), 0);
    assert.equal(numberOrNull('42'), 42);
    for (const value of [undefined, 'abc', Number.NaN, {}]) {
        assert.equal(numberOrNull(value), null, JSON.stringify(value));
    }
});

test('null and the empty string pass Number() as 0: callers must not send them', () => {
    assert.equal(numberOrNull(null), 0);
    assert.equal(numberOrNull(''), 0);
});
