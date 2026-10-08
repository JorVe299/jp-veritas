// The flags on the sign-in cookies, and the secure default when COOKIE_SECURE is unset

// Set before require: auth.js reads the environment at load (one process per test file)
process.env.DISCORD_CLIENT_ID = 'test-client';
process.env.DISCORD_CLIENT_SECRET = 'test-secret';
process.env.DISCORD_REDIRECT_URI = 'http://localhost:3001/api/auth/callback';
process.env.SESSION_SECRET = 'test-session-secret';

const test = require('node:test');
const assert = require('node:assert');
const auth = require('./auth');
const oauthCookies = require('./oauthCookies');

/** Collects every res.cookie / res.clearCookie call as { name, value, options } */
function recorder() {
    const written = [];
    const cleared = [];
    const res = {
        cookie(name, value, options) { written.push({ name, value, options }); return res; },
        clearCookie(name, options) { cleared.push({ name, options }); return res; }
    };
    return { res, written, cleared };
}

test.beforeEach(() => {
    delete process.env.COOKIE_SECURE;
    process.env.DISCORD_REDIRECT_URI = 'http://localhost:3001/api/auth/callback';
});

// --- Flags ----------------------------------------------------------------

test('both sign-in cookies are httpOnly, sameSite lax, path-wide and short-lived', () => {
    const { res, written } = recorder();
    oauthCookies.set(res, 'abc', 'panel');

    assert.deepEqual(written.map(c => c.name), [auth.STATE_COOKIE, oauthCookies.SURFACE_COOKIE]);
    for (const { name, options } of written) {
        assert.equal(options.httpOnly, true, `${name} must not be readable from a script`);
        assert.equal(options.sameSite, 'lax', name);
        assert.equal(options.path, '/', name);
        assert.equal(options.maxAge, 10 * 60 * 1000, name);
    }
});

test('the state and the surface are the values that were passed', () => {
    const { res, written } = recorder();
    oauthCookies.set(res, 'state-value', 'portal');
    assert.equal(written[0].value, 'state-value');
    assert.equal(written[1].value, 'portal');
});

// --- The secure flag ------------------------------------------------------

test('COOKIE_SECURE=true marks the cookies secure whatever the redirect URI says', () => {
    process.env.COOKIE_SECURE = 'true';
    assert.equal(oauthCookies.secure(), true);
    assert.equal(oauthCookies.options().secure, true);
});

test('COOKIE_SECURE=false leaves them plain, so a LAN panel on http still signs in', () => {
    process.env.COOKIE_SECURE = 'false';
    process.env.DISCORD_REDIRECT_URI = 'https://panel.example.com/api/auth/callback';
    assert.equal(oauthCookies.secure(), false);
});

test('unset COOKIE_SECURE takes the flag from the redirect URI scheme', () => {
    process.env.DISCORD_REDIRECT_URI = 'https://panel.example.com/api/auth/callback';
    assert.equal(oauthCookies.secure(), true);

    process.env.DISCORD_REDIRECT_URI = 'http://192.168.1.10:3001/api/auth/callback';
    assert.equal(oauthCookies.secure(), false);
});

test('an unset redirect URI defaults to plain, not to a cookie that never arrives', () => {
    delete process.env.DISCORD_REDIRECT_URI;
    assert.equal(oauthCookies.secure(), false);
});

test('surrounding whitespace and case in COOKIE_SECURE are ignored', () => {
    process.env.COOKIE_SECURE = '  TRUE \n';
    assert.equal(oauthCookies.secure(), true);
    process.env.COOKIE_SECURE = ' False ';
    assert.equal(oauthCookies.secure(), false);
});

// --- Reading back ---------------------------------------------------------

test('the state is read back, and a missing or empty one reads as null', () => {
    assert.equal(oauthCookies.readState({ cookies: { [auth.STATE_COOKIE]: 'abc' } }), 'abc');
    assert.equal(oauthCookies.readState({ cookies: { [auth.STATE_COOKIE]: '' } }), null);
    assert.equal(oauthCookies.readState({ cookies: {} }), null);
    assert.equal(oauthCookies.readState({}), null);
});

test('only the exact value portal picks the portal; anything else means panel', () => {
    const surface = (value) => oauthCookies.readSurface({ cookies: { [oauthCookies.SURFACE_COOKIE]: value } });
    assert.equal(surface('portal'), 'portal');
    for (const value of ['panel', 'Portal', '/id', '', undefined]) {
        assert.equal(surface(value), 'panel', `${value} must not reach the portal`);
    }
    assert.equal(oauthCookies.readSurface({}), 'panel');
});

test('clearing removes both cookies on the same path they were set on', () => {
    const { res, cleared } = recorder();
    oauthCookies.clear(res);
    assert.deepEqual(cleared.map(c => c.name), [auth.STATE_COOKIE, oauthCookies.SURFACE_COOKIE]);
    for (const { options } of cleared) assert.equal(options.path, '/');
});
