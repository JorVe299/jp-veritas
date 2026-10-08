// Rail grouping of one roster page; the hook itself needs a DOM and stays untested
// A down bridge may not produce an "on the server now" rail: isOnline is then unknown

import { test } from 'vitest';
import assert from 'node:assert/strict';

import { buildRails } from './useRoster';

const player = (name, job, over) => ({
    citizenid: name,
    job: job ? { name: job, label: job } : null,
    isOnline: false,
    ...over,
});

const titles = (rails) => rails.map((rail) => rail.title);
const ids = (rails) => rails.map((rail) => rail.id);

test('an empty page yields no rails', () => {
    assert.deepEqual(buildRails([], false), []);
    assert.deepEqual(buildRails(null, false), []);
    assert.deepEqual(buildRails(undefined, true), []);
});

test('online players lead in their own rail and are not repeated below', () => {
    const players = [
        player('a', 'police', { isOnline: true }),
        player('b', 'police', { isOnline: true }),
        player('c', 'police'),
        player('d', 'police'),
    ];
    const rails = buildRails(players, false);
    assert.equal(rails[0].id, 'online');
    assert.equal(rails[0].tone, 'live');
    assert.equal(rails[0].players.length, 2);
    assert.equal(rails[1].players.length, 2);
});

test('a down bridge gives no online rail at all', () => {
    const players = [player('a', 'police', { isOnline: true }), player('b', 'police')];
    const rails = buildRails(players, true);
    assert.equal(ids(rails).includes('online'), false);
    assert.equal(rails[0].players.length, 2);
});

test('nobody online means no online rail, bridge up', () => {
    const rails = buildRails([player('a', 'police'), player('b', 'police')], false);
    assert.equal(ids(rails).includes('online'), false);
});

test('jobs are ordered by size, ties alphabetically', () => {
    const players = [
        player('a', 'police'), player('b', 'police'), player('c', 'police'),
        player('d', 'mechanic'), player('e', 'mechanic'),
        player('f', 'ambulance'), player('g', 'ambulance'),
    ];
    assert.deepEqual(titles(buildRails(players, false)), ['police', 'ambulance', 'mechanic']);
});

test('single-job players share one final rail', () => {
    const players = [
        player('a', 'police'), player('b', 'police'),
        player('c', 'mechanic'),
        player('d', 'taxi'),
    ];
    const rails = buildRails(players, false);
    assert.deepEqual(titles(rails), ['police', 'Other roles']);
    assert.equal(rails[1].id, 'other');
    assert.equal(rails[1].players.length, 2);
});

test('a lone leftover keeps its own job as the heading', () => {
    const players = [player('a', 'police'), player('b', 'police'), player('c', 'mechanic')];
    const rails = buildRails(players, false);
    assert.deepEqual(titles(rails), ['police', 'mechanic']);
    assert.equal(rails[1].id, 'other');
});

test('jobless players group under Unemployed like any other job', () => {
    const players = [player('a', null), player('b', null), player('c', 'police'), player('d', 'police')];
    assert.deepEqual(titles(buildRails(players, false)).sort(), ['Unemployed', 'police']);
});

test('the job label is the rail key, not the internal name', () => {
    const players = [
        { citizenid: 'a', job: { name: 'police', label: 'Police', grade: { name: 'Chief' } } },
        { citizenid: 'b', job: { name: 'police', label: 'Police', grade: { name: 'Cadet' } } },
    ];
    const rails = buildRails(players, false);
    assert.deepEqual(titles(rails), ['Police']);
    assert.equal(rails[0].players.length, 2);
});

test('every player on the page lands in exactly one rail', () => {
    const players = [
        player('a', 'police', { isOnline: true }),
        player('b', 'police'), player('c', 'police'),
        player('d', 'mechanic'),
        player('e', null),
    ];
    const seen = buildRails(players, false).flatMap((rail) => rail.players.map((p) => p.citizenid));
    assert.equal(seen.length, players.length);
    assert.equal(new Set(seen).size, players.length);
});
