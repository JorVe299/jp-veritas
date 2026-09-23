// backend/utils/rateLimit.test.js
const test = require('node:test');
const assert = require('node:assert');
const { oncePer } = require('./rateLimit');

// A stand-in for Express's req/res pair, holding only what the limiter touches.
function call(limit, user, ip = '10.0.0.1') {
    const req = { user: user ? { id: user } : undefined, ip };
    const out = { status: 200, headers: {}, body: null, passed: false };
    const res = {
        set(k, v) { out.headers[k] = v; return res; },
        status(code) { out.status = code; return res; },
        json(body) { out.body = body; return res; }
    };
    limit(req, res, () => { out.passed = true; });
    return out;
}

function clock(start = 1_000_000) {
    let t = start;
    const now = () => t;
    now.advance = (ms) => { t += ms; };
    return now;
}

test('the first request goes through', () => {
    const limit = oncePer('x', 60_000, clock());
    assert.equal(call(limit, 'a').passed, true);
});

test('a second request inside the minute is refused, and says how long is left', () => {
    const now = clock();
    const limit = oncePer('x', 60_000, now);
    call(limit, 'a');
    now.advance(15_000);

    const second = call(limit, 'a');
    assert.equal(second.passed, false);
    assert.equal(second.status, 429);
    assert.equal(second.headers['Retry-After'], '45');
    assert.equal(second.body.retryAfter, 45);
});

test('once the minute is over it goes through again', () => {
    const now = clock();
    const limit = oncePer('x', 60_000, now);
    call(limit, 'a');
    now.advance(60_000);
    assert.equal(call(limit, 'a').passed, true);
});

test('a refused request does not restart the minute', () => {
    const now = clock();
    const limit = oncePer('x', 60_000, now);
    call(limit, 'a');
    now.advance(30_000);
    call(limit, 'a'); // refused
    now.advance(30_000);
    assert.equal(call(limit, 'a').passed, true);
});

test('one person waiting does not hold up another', () => {
    const limit = oncePer('x', 60_000, clock());
    call(limit, 'a');
    assert.equal(call(limit, 'b').passed, true);
});

test('two actions keep separate minutes', () => {
    const now = clock();
    const one = oncePer('one', 60_000, now);
    const two = oncePer('two', 60_000, now);
    call(one, 'a');
    assert.equal(call(two, 'a').passed, true);
});

test('without a session the address is what is limited', () => {
    const limit = oncePer('x', 60_000, clock());
    call(limit, null, '10.0.0.1');
    assert.equal(call(limit, null, '10.0.0.1').passed, false);
    assert.equal(call(limit, null, '10.0.0.2').passed, true);
});
