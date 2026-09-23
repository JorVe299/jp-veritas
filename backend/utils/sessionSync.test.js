// backend/utils/sessionSync.test.js
//
// A role taken away in Discord has to stop working within a minute, not
// when the cookie runs out. These pin down what the live check decides, and
// the two holes found alongside it: a path spelled '/API/...' walking past
// the login, and the inventory route minting cash for somebody who may not
// change cash.

// Set before anything reads them: auth.js takes its configuration from the
// environment at load time. Each test file runs in its own process.
process.env.DISCORD_CLIENT_ID = 'test-client';
process.env.DISCORD_CLIENT_SECRET = 'test-secret';
process.env.DISCORD_REDIRECT_URI = 'http://localhost/api/auth/callback';
process.env.SESSION_SECRET = 'test-session-secret';
process.env.DISCORD_GUILD_ID = '';
process.env.DISCORD_ROLE_SUPPORTER = 'discord-role-supporter';

const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const auth = require('./auth');
const perms = require('./permissions');

const NOW = 1_800_000_000;
const TOKENS = { accessToken: 'access-1', refreshToken: 'refresh-1', expiresAt: NOW + 3600 };

function session(extra = {}) {
    return {
        sub: '111111111111111111',
        username: 'someone',
        globalName: 'Someone',
        avatar: null,
        via: 'role:discord-role-supporter',
        role: 'supporter',
        portal: false,
        dt: auth.sealTokens(TOKENS),
        syncedAt: NOW - 120,
        exp: NOW + 3600,
        ...extra
    };
}

// Discord and the database, as the tests want them to answer.
function deps(over = {}) {
    return {
        guildId: 'guild-1',
        now: () => NOW,
        fetchGuildRoles: async () => ({ member: true, roles: ['discord-role-supporter'] }),
        refreshTokens: async () => ({ accessToken: 'access-2', refreshToken: 'refresh-2', expiresAt: NOW + 7200 }),
        hasCharacters: async () => false,
        ...over
    };
}

function httpError(status, data = {}) {
    const e = new Error(`HTTP ${status}`);
    e.response = { status, data };
    return e;
}

// --- Tokens in the cookie -------------------------------------------------

test('the Discord tokens survive the round trip through the cookie', () => {
    assert.deepEqual(auth.unsealTokens(auth.sealTokens(TOKENS)), TOKENS);
});

test('the cookie does not carry the token in readable form', () => {
    assert.equal(auth.sealTokens(TOKENS).includes('access-1'), false);
});

test('a tampered seal opens to nothing rather than to something else', () => {
    const sealed = auth.sealTokens(TOKENS);
    const flipped = sealed.slice(0, -2) + (sealed.endsWith('A') ? 'BB' : 'AA');
    assert.equal(auth.unsealTokens(flipped), null);
    assert.equal(auth.unsealTokens('not a seal'), null);
    assert.equal(auth.unsealTokens(undefined), null);
});

// --- What the live check decides -----------------------------------------

test('an unchanged role is confirmed, and the session is not extended', async () => {
    const out = await auth.syncSession(session(), deps());
    assert.equal(out.kind, 'updated');
    assert.equal(out.payload.role, 'supporter');
    assert.equal(out.payload.syncedAt, NOW);
    assert.equal(out.payload.exp, NOW + 3600, 'checking the role must not reset the expiry');
});

test('a Discord role taken away takes the panel role with it', async () => {
    const out = await auth.syncSession(session(), deps({
        fetchGuildRoles: async () => ({ member: true, roles: [] }),
        hasCharacters: async () => true,
    }));
    assert.equal(out.kind, 'updated');
    assert.equal(out.payload.role, null, 'no panel role any more');
    assert.equal(out.payload.portal, true, 'the portal still stands on its own');
});

test('with neither a role nor a character left, the session ends', async () => {
    const out = await auth.syncSession(session(), deps({
        fetchGuildRoles: async () => ({ member: true, roles: [] }),
    }));
    assert.equal(out.kind, 'ended');
});

test('leaving the Discord ends a session that had nothing else', async () => {
    const out = await auth.syncSession(session({ portal: true }), deps({
        fetchGuildRoles: async () => ({ member: false, roles: [] }),
        hasCharacters: async () => true,
    }));
    assert.equal(out.kind, 'ended');
    assert.match(out.reason, /no longer a member/);
});

test('a role granted in Discord arrives without signing in again', async () => {
    const out = await auth.syncSession(session({ role: null, portal: true, via: 'portal' }), deps({
        hasCharacters: async () => true,
    }));
    assert.equal(out.kind, 'updated');
    assert.equal(out.payload.role, 'supporter');
});

test('Discord being down keeps the session as it is, and says to retry later', async () => {
    const out = await auth.syncSession(session(), deps({
        fetchGuildRoles: async () => { throw httpError(502); },
    }));
    assert.equal(out.kind, 'kept');
    assert.ok(out.retryAfterMs >= 60_000);
});

test('a rate limit is waited out for as long as Discord asks', async () => {
    const out = await auth.syncSession(session(), deps({
        fetchGuildRoles: async () => { throw httpError(429, { retry_after: 300 }); },
    }));
    assert.equal(out.kind, 'kept');
    assert.equal(out.retryAfterMs, 300_000);
});

test('a refused access token is refreshed once, and the new tokens are kept', async () => {
    let calls = 0;
    const out = await auth.syncSession(session(), deps({
        fetchGuildRoles: async (token) => {
            calls++;
            if (token === 'access-1') throw httpError(401);
            return { member: true, roles: ['discord-role-supporter'] };
        },
    }));
    assert.equal(out.kind, 'updated');
    assert.equal(calls, 2);
    assert.equal(auth.unsealTokens(out.payload.dt).accessToken, 'access-2');
});

test('an expired access token is refreshed before Discord is asked', async () => {
    const seen = [];
    const expired = session({ dt: auth.sealTokens({ ...TOKENS, expiresAt: NOW - 10 }) });
    await auth.syncSession(expired, deps({
        fetchGuildRoles: async (token) => { seen.push(token); return { member: true, roles: [] }; },
        hasCharacters: async () => true,
    }));
    assert.deepEqual(seen, ['access-2']);
});

test('an authorization removed in Discord ends the session', async () => {
    const out = await auth.syncSession(session(), deps({
        fetchGuildRoles: async () => { throw httpError(401); },
        refreshTokens: async () => { throw httpError(400, { error: 'invalid_grant' }); },
    }));
    assert.equal(out.kind, 'ended');
});

test('a session from before the live check signs in again once', async () => {
    const out = await auth.syncSession(session({ dt: undefined }), deps());
    assert.equal(out.kind, 'ended');
});

test('a database that cannot answer does not take the portal away', async () => {
    const out = await auth.syncSession(session({ role: null, portal: true, via: 'portal' }), deps({
        fetchGuildRoles: async () => ({ member: true, roles: [] }),
        hasCharacters: async () => { throw new Error('ECONNREFUSED'); },
    }));
    assert.equal(out.kind, 'updated');
    assert.equal(out.payload.portal, true);
});

// --- The middleware, end to end -------------------------------------------

function appWith(...routers) {
    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use(auth.requireAuth);
    app.use(perms.enforce);
    for (const r of routers) app.use(r);
    return app;
}

async function request(app, method, path, { cookie, body } = {}) {
    const server = app.listen(0);
    try {
        const port = server.address().port;
        const res = await fetch(`http://127.0.0.1:${port}${path}`, {
            method,
            headers: {
                ...(cookie ? { Cookie: `${auth.SESSION_COOKIE}=${cookie}` } : {}),
                ...(body ? { 'Content-Type': 'application/json' } : {}),
            },
            body: body ? JSON.stringify(body) : undefined,
        });
        return { status: res.status, body: await res.json().catch(() => null), setCookie: res.headers.get('set-cookie') };
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

const dataRouter = express.Router();
dataRouter.get('/api/players', (req, res) => res.json({ leaked: true }));

for (const path of ['/api/players', '/API/players', '/Api/Players', '/aPi/players']) {
    test(`${path} without a session is refused, not served`, async () => {
        const res = await request(appWith(dataRouter), 'GET', path);
        assert.equal(res.status, 401);
        assert.notEqual(res.body?.leaked, true);
    });
}

test('an odd spelling of an API path matches no rule and is denied even for the owner', async () => {
    const res = await request(appWith(dataRouter), 'GET', '/API/players', { cookie: freshCookie('owner') });
    assert.equal(res.status, 403);
});

test('a session checked within the minute is not sent to Discord again', async () => {
    // No guild is configured in this file and no Discord is reachable: a
    // check that ran anyway would re-issue the cookie. It must not.
    const res = await request(appWith(dataRouter), 'GET', '/api/players', { cookie: freshCookie('owner') });
    assert.equal(res.status, 200);
    assert.equal(res.setCookie, null);
});

// --- Cash through the inventory -------------------------------------------

test('adding cash through the inventory needs money.edit, not only inventory.edit', async () => {
    const { router } = require('../routes/inventory');
    const role = 'no-such-role'; // holds nothing, so money.edit is certainly missing
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => { req.user = { id: 'x', role }; next(); });
    app.use(router);

    for (const item of ['money', 'black_money', 'MONEY']) {
        const res = await request(app, 'POST', '/api/manage/inventory', {
            body: { citizenid: 'ABC123', action: 'add', item, amount: 1000000 },
        });
        assert.equal(res.status, 403, `${item} must be refused`);
        assert.equal(res.body.required, 'money.edit');
    }
});
