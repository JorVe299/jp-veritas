// The central flood brake: normal panel traffic must never meet it, a flood must
// Buckets are per principal, so one noisy staff member cannot starve the resource sync

// Set before require: auth.js reads the environment at load (one process per test file)
process.env.DISCORD_CLIENT_ID = 'test-client';
process.env.DISCORD_CLIENT_SECRET = 'test-secret';
process.env.DISCORD_REDIRECT_URI = 'http://localhost:3001/api/auth/callback';
process.env.SESSION_SECRET = 'test-session-secret';
process.env.DISCORD_GUILD_ID = '';

const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const { rateLimit } = require('express-rate-limit');
const auth = require('./auth');
const perms = require('./permissions');
const resourceAuth = require('./resourceAuth');
const limits = require('./apiLimits');

const SECRET = 'a'.repeat(64);
const FLOOD_LIMIT = 4;

// Stand-in routers: the middleware chain decides, the handlers only prove they were reached
const routes = express.Router();
routes.post('/api/system/refresh', (req, res) => res.json({ reloaded: true }));
routes.get('/api/players', (req, res) => res.json({ listed: true }));

/** The server.js order, with a limit small enough to reach inside a test */
function app(limit = FLOOD_LIMIT) {
    const a = express();
    a.use(express.json());
    a.use(cookieParser());
    a.use(resourceAuth.identify);
    a.use(auth.requireAuth);
    a.use(rateLimit(limits.options(limit, limits.skipNonApi)));
    a.use(perms.enforce);
    a.use(routes);
    a.get('/index.html', (req, res) => res.json({ static: true }));
    return a;
}

/** One server for a whole burst: the limiter's window outlives the individual requests */
async function burst(count, path, { method = 'GET', secret, cookie, limit } = {}) {
    const server = app(limit).listen(0);
    const statuses = [];
    try {
        for (let i = 0; i < count; i++) {
            const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
                method,
                headers: {
                    ...(secret === undefined ? {} : { 'X-Veritas-Secret': secret }),
                    ...(cookie ? { Cookie: `${auth.SESSION_COOKIE}=${cookie}` } : {})
                }
            });
            statuses.push(res.status);
        }
        return statuses;
    } finally {
        server.close();
    }
}

function cookieFor(id, role = 'owner') {
    const now = Math.floor(Date.now() / 1000);
    return jwt.sign(
        { sub: id, username: `staff-${id}`, role, portal: false, syncedAt: now, exp: now + 3600 },
        process.env.SESSION_SECRET
    );
}

test.beforeEach(() => { process.env.RESOURCE_SECRET = SECRET; });

// --- The bucket key -------------------------------------------------------

test('the resource has a bucket of its own, never a staff member\'s', () => {
    assert.equal(limits.keyOf({ resource: { capabilities: ['system.edit'] } }), 'resource');
    assert.equal(limits.keyOf({ resource: { capabilities: [] }, user: { id: '42' } }), 'resource');
});

test('a signed-in request is keyed by Discord id, not by address', () => {
    assert.equal(limits.keyOf({ user: { id: '42' }, ip: '10.0.0.1' }), 'user:42');
    assert.notEqual(limits.keyOf({ user: { id: '42' }, ip: '10.0.0.1' }),
        limits.keyOf({ user: { id: '43' }, ip: '10.0.0.1' }));
});

test('without a session the address is the bucket, and an unknown one still has a key', () => {
    assert.equal(limits.keyOf({ ip: '10.0.0.1' }), 'ip:10.0.0.1');
    assert.equal(limits.keyOf({}), 'ip:unknown');
});

// --- What is counted ------------------------------------------------------

test('only /api is counted; the panel\'s own files stay reachable', () => {
    assert.equal(limits.skipNonApi({ path: '/api/players' }), false);
    assert.equal(limits.skipNonApi({ path: '/API/players' }), false, 'case-blind (BACKEND.md §4)');
    assert.equal(limits.skipNonApi({ path: '/index.html' }), true);
    assert.equal(limits.skipNonApi({ path: '/' }), true);
});

test('the window and the two limits suit a handful of staff plus one resource', () => {
    assert.equal(limits.WINDOW_MS, 60_000);
    assert.ok(limits.API_PER_WINDOW >= 300, 'a panel page opens many requests at once');
    assert.ok(limits.AUTH_PER_WINDOW >= 60, 'the frontend polls /api/auth/me once a minute per tab');
});

// --- trust proxy ----------------------------------------------------------

test('trust proxy is off unless configured, so X-Forwarded-For cannot be forged', () => {
    for (const value of [undefined, '', '   ', 'false', 'FALSE']) {
        if (value === undefined) delete process.env.TRUST_PROXY;
        else process.env.TRUST_PROXY = value;
        assert.equal(limits.trustProxy(), false, String(value));
    }
});

test('a hop count, true, or an address list are passed to Express as they are', () => {
    process.env.TRUST_PROXY = '1';
    assert.equal(limits.trustProxy(), 1);
    process.env.TRUST_PROXY = 'true';
    assert.equal(limits.trustProxy(), true);
    process.env.TRUST_PROXY = '127.0.0.1, ::1';
    assert.equal(limits.trustProxy(), '127.0.0.1, ::1');
    delete process.env.TRUST_PROXY;
});

// --- Through the middleware -----------------------------------------------

test('normal traffic goes through: a real limit is nowhere near a page load', async () => {
    const statuses = await burst(25, '/api/players', {
        cookie: cookieFor('111111111111111111'),
        limit: limits.API_PER_WINDOW
    });
    assert.deepEqual([...new Set(statuses)], [200]);
});

test('a flood is cut off with 429 and a Retry-After', async () => {
    const server = app().listen(0);
    try {
        const url = `http://127.0.0.1:${server.address().port}/api/players`;
        const headers = { Cookie: `${auth.SESSION_COOKIE}=${cookieFor('222222222222222222')}` };
        for (let i = 0; i < FLOOD_LIMIT; i++) {
            assert.equal((await fetch(url, { headers })).status, 200, `request ${i + 1}`);
        }
        const refused = await fetch(url, { headers });
        assert.equal(refused.status, 429);
        assert.ok(Number(refused.headers.get('retry-after')) > 0);
        assert.equal((await refused.json()).success, false);
    } finally {
        server.close();
    }
});

test('one flooding account does not spend another account\'s window', async () => {
    const server = app().listen(0);
    try {
        const url = `http://127.0.0.1:${server.address().port}/api/players`;
        const flooder = { Cookie: `${auth.SESSION_COOKIE}=${cookieFor('333333333333333333')}` };
        for (let i = 0; i < FLOOD_LIMIT + 2; i++) await fetch(url, { headers: flooder });

        const other = { Cookie: `${auth.SESSION_COOKIE}=${cookieFor('444444444444444444')}` };
        assert.equal((await fetch(url, { headers: other })).status, 200);
    } finally {
        server.close();
    }
});

test('the resource secret still gets its sync through after staff have flooded', async () => {
    const server = app().listen(0);
    try {
        const base = `http://127.0.0.1:${server.address().port}`;
        const staff = { Cookie: `${auth.SESSION_COOKIE}=${cookieFor('555555555555555555')}` };
        for (let i = 0; i < FLOOD_LIMIT + 2; i++) await fetch(`${base}/api/players`, { headers: staff });

        const sync = await fetch(`${base}/api/system/refresh`, {
            method: 'POST',
            headers: { 'X-Veritas-Secret': SECRET }
        });
        assert.equal(sync.status, 200);
        assert.equal((await sync.json()).reloaded, true);
    } finally {
        server.close();
    }
});

test('a flood of static requests is not counted against the api window', async () => {
    const server = app().listen(0);
    try {
        const base = `http://127.0.0.1:${server.address().port}`;
        for (let i = 0; i < FLOOD_LIMIT + 5; i++) {
            assert.equal((await fetch(`${base}/index.html`)).status, 200, `static ${i + 1}`);
        }
    } finally {
        server.close();
    }
});
