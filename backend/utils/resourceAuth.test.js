// The resource secret end to end: it stands in for a session, and reaches only system.edit
// An unset RESOURCE_SECRET must match nothing, not everything

// Set before require: auth.js reads the environment at load (one process per test file)
process.env.DISCORD_CLIENT_ID = 'test-client';
process.env.DISCORD_CLIENT_SECRET = 'test-secret';
process.env.DISCORD_REDIRECT_URI = 'http://localhost/api/auth/callback';
process.env.SESSION_SECRET = 'test-session-secret';
process.env.DISCORD_GUILD_ID = '';

const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const auth = require('./auth');
const perms = require('./permissions');
const resourceAuth = require('./resourceAuth');

const SECRET = 'f'.repeat(64);

// Stand-in routers: the middleware chain decides, the handlers only prove they were reached
const routes = express.Router();
routes.post('/api/system/refresh', (req, res) => res.json({ reloaded: true }));
routes.get('/api/players', (req, res) => res.json({ leaked: true }));

// The server.js order: identify, requireAuth, enforce
function app() {
    const a = express();
    a.use(express.json());
    a.use(cookieParser());
    a.use(resourceAuth.identify);
    a.use(auth.requireAuth);
    a.use(perms.enforce);
    a.use(routes);
    return a;
}

async function request(method, path, { secret, cookie } = {}) {
    const server = app().listen(0);
    try {
        const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
            method,
            headers: {
                ...(secret === undefined ? {} : { 'X-Veritas-Secret': secret }),
                ...(cookie ? { Cookie: `${auth.SESSION_COOKIE}=${cookie}` } : {}),
            },
        });
        return { status: res.status, body: await res.json().catch(() => null) };
    } finally {
        server.close();
    }
}

function freshCookie(role) {
    const now = Math.floor(Date.now() / 1000);
    return jwt.sign(
        { sub: '222222222222222222', username: 'staff', role, portal: false, syncedAt: now, exp: now + 3600 },
        process.env.SESSION_SECRET
    );
}

test.beforeEach(() => { process.env.RESOURCE_SECRET = SECRET; });

// --- The compare ----------------------------------------------------------

test('only the whole secret matches', () => {
    assert.equal(resourceAuth.matches(SECRET), true);
    assert.equal(resourceAuth.matches(SECRET.slice(0, 32)), false, 'a prefix is not a match');
    assert.equal(resourceAuth.matches(SECRET + 'f'), false);
    assert.equal(resourceAuth.matches(SECRET.toUpperCase()), false);
});

test('surrounding whitespace in the configured value is ignored', () => {
    process.env.RESOURCE_SECRET = `  ${SECRET}\n`;
    assert.equal(resourceAuth.matches(SECRET), true);
});

test('an unset or empty secret matches nothing at all', () => {
    for (const configured of [undefined, '', '   ']) {
        if (configured === undefined) delete process.env.RESOURCE_SECRET;
        else process.env.RESOURCE_SECRET = configured;

        for (const given of ['', '   ', SECRET, undefined, null]) {
            assert.equal(resourceAuth.matches(given), false, `${configured} must not match ${given}`);
        }
    }
});

test('the resource may reload the catalog and nothing else', () => {
    assert.equal(resourceAuth.allows('system.edit'), true);
    for (const capability of ['system.view', 'players.view', 'money.edit', 'permissions.edit']) {
        assert.equal(resourceAuth.allows(capability), false, capability);
    }
});

// --- Through the middleware -----------------------------------------------

test('the refresh goes through with the configured secret and no session', async () => {
    const res = await request('POST', '/api/system/refresh', { secret: SECRET });
    assert.equal(res.status, 200);
    assert.equal(res.body.reloaded, true);
});

test('a wrong secret is refused', async () => {
    for (const secret of ['nope', SECRET.slice(0, 63), `${SECRET}f`, 'f'.repeat(63) + 'e']) {
        const res = await request('POST', '/api/system/refresh', { secret });
        assert.equal(res.status, 401, `${secret} must be refused`);
        assert.notEqual(res.body?.reloaded, true);
    }
});

test('no secret and no session is still refused', async () => {
    const res = await request('POST', '/api/system/refresh');
    assert.equal(res.status, 401);
    assert.notEqual(res.body?.reloaded, true);
});

test('with RESOURCE_SECRET unset, presenting any secret is refused', async () => {
    for (const configured of ['', '   ']) {
        process.env.RESOURCE_SECRET = configured;
        for (const secret of ['', SECRET, 'anything']) {
            const res = await request('POST', '/api/system/refresh', { secret });
            assert.equal(res.status, 401, `an empty configured secret must not accept "${secret}"`);
            assert.notEqual(res.body?.reloaded, true);
        }
    }
});

test('a session still works without any secret', async () => {
    const res = await request('POST', '/api/system/refresh', { cookie: freshCookie('owner') });
    assert.equal(res.status, 200);
    assert.equal(res.body.reloaded, true);
});

test('the secret opens the refresh only, not the rest of the panel', async () => {
    const res = await request('GET', '/api/players', { secret: SECRET });
    assert.equal(res.status, 403);
    assert.notEqual(res.body?.leaked, true);
});
