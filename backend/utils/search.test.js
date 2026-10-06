// How a typed query is read: the same rules in JS filters and in SQL
const test = require('node:test');
const assert = require('node:assert');
const { terms, matches, sqlMatch, likeTerm, MAX_TERMS } = require('./search');

const person = ['GNM6UZLL', 'Michael', 'Peters'];

test('case does not matter', () => {
    for (const q of ['michael', 'MICHAEL', 'mIcHaEl', 'gnm6uzll']) {
        assert.equal(matches(person, terms(q)), true, q);
    }
});

test('spacing does not matter', () => {
    for (const q of ['michael peters', '  michael   peters ', 'michael\tpeters', 'michaelpeters']) {
        assert.equal(matches(person, terms(q)), true, JSON.stringify(q));
    }
});

test('word order does not matter, but every word must hit', () => {
    assert.equal(matches(person, terms('peters michael')), true);
    assert.equal(matches(person, terms('michael smith')), false);
});

test('an empty query matches everything', () => {
    assert.deepEqual(terms('   '), []);
    assert.equal(matches(person, terms('')), true);
});

test('repeated words count once and the word count is capped', () => {
    assert.deepEqual(terms('a A a b'), ['a', 'b']);
    assert.equal(terms('a b c d e f g h i').length, MAX_TERMS);
});

test('missing fields never match the text "null" or "undefined"', () => {
    assert.equal(matches([null, undefined, 'x'], terms('null')), false);
    assert.equal(matches([null, undefined, 'x'], terms('undefined')), false);
});

test('LIKE wildcards typed by a person are taken literally', () => {
    assert.equal(likeTerm('50%'), '%50\\%%');
    assert.equal(likeTerm('a_b'), '%a\\_b%');
});

test('SQL: one LIKE group per word, plus the spaceless name match', () => {
    const one = sqlMatch(['a', 'b'], ['x']);
    assert.equal(one.params.length, 3);
    assert.match(one.sql, /LOWER\(a\) LIKE \?/);

    const two = sqlMatch(['a', 'b'], ['x', 'y'], ['b']);
    assert.equal(two.params.length, 5);
    assert.equal(two.params[4], '%xy%');
    assert.match(two.sql, / AND /);
    assert.match(two.sql, /REPLACE\(CONCAT_WS\('', b\), ' ', ''\)/);
});

test('SQL: an empty query adds no condition', () => {
    assert.deepEqual(sqlMatch(['a'], []), { sql: '1=1', params: [] });
});
