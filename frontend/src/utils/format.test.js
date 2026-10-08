// Formatting contract: what a missing, zero or unreadable value is allowed to read as
// Locale-dependent output is asserted by shape, not by text: the runner's zone is not fixed

import { test } from 'vitest';
import assert from 'node:assert/strict';

import {
    formatMoney,
    formatCurrency,
    formatDelta,
    formatCompact,
    formatCurrencyCompact,
    formatTime,
    formatDateTime,
    formatCoord,
    jobTitle,
    jobGroup,
    initials,
    parseAmount,
} from './format';

const DASH = '—';

// --- Money ----------------------------------------------------------------

test('money has no decimals and groups thousands', () => {
    assert.equal(formatMoney(1234567.8), '1,234,568');
    assert.equal(formatCurrency(1234567), '$1,234,567');
});

test('zero is a figure, not a missing value', () => {
    assert.equal(formatMoney(0), '0');
    assert.equal(formatCurrency(0), '$0');
    assert.equal(formatDelta(0), '+$0');
});

test('anything unreadable as a number becomes a dash', () => {
    for (const value of [undefined, 'abc', Number.NaN, Infinity, {}]) {
        assert.equal(formatMoney(value), DASH, JSON.stringify(value));
        assert.equal(formatCurrency(value), DASH);
        assert.equal(formatDelta(value), DASH);
        assert.equal(formatCompact(value), DASH);
        assert.equal(formatCurrencyCompact(value), DASH);
    }
});

test('null and the empty string pass Number() as 0 and read as a figure', () => {
    // A balance that is absent, not zero, must not reach these: the caller decides
    for (const value of [null, '', '  ', []]) {
        assert.equal(formatMoney(value), '0', JSON.stringify(value));
        assert.equal(formatCurrency(value), '$0');
    }
});

test('a delta keeps its sign in front of the currency mark', () => {
    assert.equal(formatDelta(-500), '-$500');
    assert.equal(formatDelta(500), '+$500');
});

test('numeric strings are accepted the way the API sends them', () => {
    assert.equal(formatCurrency('2500'), '$2,500');
    assert.equal(formatDelta('-2500'), '-$2,500');
});

// --- Compact --------------------------------------------------------------

test('compact keeps three significant digits', () => {
    assert.equal(formatCompact(1234567), '1.23M');
    assert.equal(formatCurrencyCompact(1234), '$1.23K');
});

test('compact gives way to scientific before it would print "1000T"', () => {
    assert.equal(formatCompact(999.4e12), '999T');
    assert.match(formatCompact(1e15), /E15$/);
    assert.match(formatCompact(-1e15), /^-/);
});

// --- Dates and coordinates ------------------------------------------------

test('unix seconds and milliseconds name the same instant', () => {
    assert.equal(formatDateTime(1772012400), formatDateTime(1772012400000));
    assert.equal(formatDateTime('1772012400'), formatDateTime(1772012400));
});

test('the permanent-ban sentinel reads as its 2038 date, not as a dash', () => {
    assert.match(formatDateTime(2147483647), /2038/);
});

test('no date at all stays a dash instead of 1970', () => {
    for (const value of [null, undefined, '', 0, '0', -1, 'nope']) {
        assert.equal(formatDateTime(value), DASH, JSON.stringify(value));
    }
});

test('an ISO timestamp is read', () => {
    assert.match(formatDateTime('2026-03-04T21:40:00Z'), /Mar 0[45], 2026/);
});

test('the clock is 24-hour and two-digit', () => {
    assert.match(formatTime(new Date(Date.UTC(2026, 0, 1, 2, 14))), /^\d{2}:\d{2}$/);
});

test('a coordinate keeps one decimal and no more', () => {
    assert.equal(formatCoord('12.345'), '12.3');
    assert.equal(formatCoord(0), '0.0');
    assert.equal(formatCoord(undefined), DASH);
    assert.equal(formatCoord('abc'), DASH);
    // Number(null) is 0: a missing coordinate reads as the map origin, not as a dash
    assert.equal(formatCoord(null), '0.0');
});

// --- Job lines ------------------------------------------------------------

test('no job reads as unemployed everywhere', () => {
    for (const player of [null, undefined, {}, { job: null }, { job: {} }, { job: { name: '' } }]) {
        assert.equal(jobTitle(player), 'Unemployed', JSON.stringify(player));
        assert.equal(jobGroup(player), 'Unemployed');
    }
});

test('the grade belongs to the title, not to the rail key', () => {
    const player = { job: { name: 'police', label: 'Police', grade: { name: 'Chief' } } };
    assert.equal(jobTitle(player), 'Police · Chief');
    assert.equal(jobGroup(player), 'Police');
});

test('a job without a label falls back to its name', () => {
    assert.equal(jobTitle({ job: { name: 'ambulance' } }), 'ambulance');
    assert.equal(jobGroup({ job: { name: 'ambulance' } }), 'ambulance');
});

// --- Initials and amounts -------------------------------------------------

test('initials take first and last word, whatever the spacing', () => {
    assert.equal(initials('  michael   peters  '), 'MP');
    assert.equal(initials('jean luc picard'), 'JP');
});

test('a single word gives two letters, nothing gives two question marks', () => {
    assert.equal(initials('cher'), 'CH');
    for (const value of ['', null, undefined, '   ']) {
        assert.equal(initials(value), '??', JSON.stringify(value));
    }
});

test('a typed amount loses its separators but keeps its sign', () => {
    assert.equal(parseAmount('1,000'), 1000);
    assert.equal(parseAmount(' -2,500 '), -2500);
    assert.equal(parseAmount('0'), 0);
});

test('a typed amount that is not a number is NaN, never 0', () => {
    for (const value of ['', '   ', 'abc', null, undefined, 1000]) {
        assert.equal(Number.isNaN(parseAmount(value)), true, JSON.stringify(value));
    }
});
