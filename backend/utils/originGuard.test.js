// The token-free CSRF defence: which state-changing requests reach a handler and which do not
// A false pass here is a cross-site write, so the refusals are asserted one by one

const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const originGuard = require('./originGuard');
const resourceAuth = require('./resourceAuth');

const PANEL_HOST = 'panel.example.com';

/** Runs the guard over a stand-in request; `passed` says whether a handler would be reached */
function run({ method = 'POST', path = '/api/manage/money', headers = {} } = {}) {
    const req = { method, path, headers: { host: PANEL_HOST, ...headers } };
    const out = { status: 200, body: null, passed: false };
    const res = {
        status(code) { out.status = code; return res; },
        json(body) { out.body = body; return res; }
    };
    originGuard.guard(req, res, () => { out.passed = true; });
    return out;
}

test.beforeEach(() => { delete process.env.PANEL_ORIGIN; });

// --- What passes ----------------------------------------------------------

test('reads are never blocked', () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
        assert.equal(run({ method, headers: { origin: 'https://evil.example' } }).passed, true, method);
    }
});

test('a request from the panel itself passes, whatever scheme the browser used', () => {
    for (const origin of [`https://${PANEL_HOST}`, `http://${PANEL_HOST}`]) {
        assert.equal(run({ headers: { origin } }).passed, true, origin);
    }
});

test('Referer stands in when Origin is absent', () => {
    assert.equal(run({ headers: { referer: `https://${PANEL_HOST}/manage` } }).passed, true);
});

test('the host a TLS terminator forwards is accepted too', () => {
    const headers = { host: 'localhost:3001', 'x-forwarded-host': PANEL_HOST, origin: `https://${PANEL_HOST}` };
    assert.equal(run({ headers }).passed, true);
});

test('the Vite dev server passes once PANEL_ORIGIN names it', () => {
    assert.equal(run({ headers: { origin: 'http://localhost:5173' } }).passed, false, 'not before');
    process.env.PANEL_ORIGIN = 'http://localhost:5173';
    assert.equal(run({ headers: { origin: 'http://localhost:5173' } }).passed, true);
});

test('the resource secret header is exempt: it cannot be set cross-site without a preflight', () => {
    const headers = { [resourceAuth.HEADER]: 'whatever' };
    assert.equal(run({ method: 'POST', path: '/api/system/refresh', headers }).passed, true);
});

test('non-api paths are left alone; nothing there changes state', () => {
    assert.equal(run({ path: '/anything', headers: { origin: 'https://evil.example' } }).passed, true);
});

// --- What is refused ------------------------------------------------------

test('a cross-site write is refused with 403 and reaches no handler', () => {
    const out = run({ headers: { origin: 'https://evil.example' } });
    assert.equal(out.passed, false);
    assert.equal(out.status, 403);
    assert.equal(out.body.success, false);
    assert.equal(out.body.origin, 'evil.example');
});

test('every state-changing method is covered', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
        assert.equal(run({ method, headers: { origin: 'https://evil.example' } }).passed, false, method);
    }
});

test('a write with no Origin and no Referer is refused; browsers always send one', () => {
    const out = run({ headers: {} });
    assert.equal(out.passed, false);
    assert.equal(out.status, 403);
    assert.equal(out.body.origin, null);
});

test('a host that only looks like the panel is refused', () => {
    for (const origin of [`https://${PANEL_HOST}.evil.example`, 'https://evilpanel.example.com', 'null']) {
        assert.equal(run({ headers: { origin } }).passed, false, origin);
    }
});

test('a present but unparsable Origin is refused; Referer does not rescue it', () => {
    assert.equal(run({ headers: { origin: 'not a url' } }).passed, false);
    assert.equal(run({ headers: { origin: 'not a url', referer: `https://${PANEL_HOST}/x` } }).passed, false);
});

test('the uppercase path spelling is covered as well (BACKEND.md §4)', () => {
    const out = run({ path: '/API/manage/money', headers: { origin: 'https://evil.example' } });
    assert.equal(out.passed, false);
});

// --- Through a real server ------------------------------------------------

test('a real cross-site POST gets 403 and the handler never runs', async () => {
    let reached = false;
    const app = express();
    app.use(originGuard.guard);
    app.post('/api/manage/money', (req, res) => { reached = true; res.json({ written: true }); });

    const server = app.listen(0);
    try {
        const port = server.address().port;
        const evil = await fetch(`http://127.0.0.1:${port}/api/manage/money`, {
            method: 'POST',
            headers: { origin: 'https://evil.example' }
        });
        assert.equal(evil.status, 403);
        assert.equal(reached, false);

        const own = await fetch(`http://127.0.0.1:${port}/api/manage/money`, {
            method: 'POST',
            headers: { origin: `http://127.0.0.1:${port}` }
        });
        assert.equal(own.status, 200);
        assert.equal(reached, true);
    } finally {
        server.close();
    }
});
