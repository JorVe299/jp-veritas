// What a write may claim afterwards: live, saved to the database, or nothing about either
// Server text always wins over an axios message; a missing route claims no mode

import { test } from 'vitest';
import assert from 'node:assert/strict';

import {
    modeOf,
    modeDetail,
    joinDetail,
    failureNote,
    successNote,
} from './writeFeedback';

test('only the two known modes are reported', () => {
    assert.equal(modeOf({ data: { mode: 'live' } }), 'live');
    assert.equal(modeOf({ data: { mode: 'offline' } }), 'offline');
    for (const answer of [undefined, {}, { data: {} }, { data: { mode: 'queued' } }, { data: { mode: 'LIVE' } }]) {
        assert.equal(modeOf(answer), null, JSON.stringify(answer));
    }
});

test('an unknown mode adds no sentence at all', () => {
    assert.equal(modeDetail('live'), 'Applied live.');
    assert.equal(modeDetail('offline'), 'Saved to the database.');
    assert.equal(modeDetail(null), '');
    assert.equal(modeDetail('queued'), '');
});

test('joining drops the empty parts and gives up rather than returning ""', () => {
    assert.equal(joinDetail('a', '', null, 'b', undefined), 'a b');
    assert.equal(joinDetail(), undefined);
    assert.equal(joinDetail('', null), undefined);
});

// --- Failure --------------------------------------------------------------

test('the server error is shown, with its hint appended', () => {
    const note = failureNote('Ban failed', {
        response: { data: { error: 'Player is online', hint: 'Kick first' } },
        message: 'Request failed with status code 409',
    });
    assert.deepEqual(note, { tone: 'error', title: 'Ban failed', detail: 'Player is online Kick first' });
});

test('with no body the axios message stands in', () => {
    const note = failureNote('Ban failed', { message: 'Network Error' });
    assert.equal(note.detail, 'Network Error');
});

test('a failure with nothing readable still says something', () => {
    assert.equal(failureNote('Ban failed', undefined).detail, 'The server did not answer.');
    assert.equal(failureNote('Ban failed', {}).detail, 'The server did not answer.');
});

// --- Success --------------------------------------------------------------

test('the server message replaces the fallback title', () => {
    const note = successNote({ data: { message: 'Ban written' } }, 'Done');
    assert.equal(note.tone, 'success');
    assert.equal(note.title, 'Ban written');
});

test('mode, extra and hint are joined in that order', () => {
    const note = successNote(
        { data: { message: 'Saved', mode: 'offline', hint: 'Takes effect on next join' } },
        'Done',
        '3 items',
    );
    assert.equal(note.detail, 'Saved to the database. 3 items Takes effect on next join');
});

test('an answer without body or mode keeps the fallback and says nothing more', () => {
    assert.deepEqual(successNote(undefined, 'Done'), { tone: 'success', title: 'Done', detail: undefined });
});
