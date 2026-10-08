// publicUser(): only an explicit portal: true opens Veritas ID
// No panel role must never fall through to panel permissions

const test = require('node:test');
const assert = require('node:assert');

const { publicUser } = require('./auth');

const BASE = { sub: '111111111111111111', username: 'someone', globalName: 'Someone', avatar: null, via: 'user' };

test('a session that was refused the portal says so', () => {
    const user = publicUser({ ...BASE, role: 'administrator', portal: false });
    assert.equal(user.portal, false);
});

test('a session with the portal says so', () => {
    const user = publicUser({ ...BASE, role: null, portal: true });
    assert.equal(user.portal, true);
});

test('a session without a portal flag gets no portal', () => {
    // Only explicit true; a missing field is not access
    const user = publicUser({ ...BASE, role: 'owner' });
    assert.equal(user.portal, false);
});

test('the panel offers the way in for exactly the right sessions', () => {
    // Same condition as App.jsx; a mistake here silently removes the only door
    const offersLink = (u) => u.portal === true;

    assert.equal(offersLink(publicUser({ ...BASE, role: null, portal: true })), true, 'a portal user');
    assert.equal(offersLink(publicUser({ ...BASE, role: 'owner', portal: true })), true, 'staff who also play');
    assert.equal(offersLink(publicUser({ ...BASE, role: 'administrator', portal: false })), false,
        'staff with no character are not sent to a page that will refuse them');
});

test('no session at all is still nothing', () => {
    assert.equal(publicUser(null), null);
});

test('a roleless session gets no capabilities and no role label', () => {
    // No panel role must never mean every panel permission
    const user = publicUser({ ...BASE, role: null, portal: true });
    assert.equal(user.role, null);
    assert.equal(user.roleLabel, null);
    assert.deepEqual(user.capabilities, []);
});

// --- The session cookie's secure flag -------------------------------------
// SECURITY: it carries the sealed Discord tokens, so it must never lag the sign-in cookies

const { cookieSecure, cookieOptions } = require('./auth');

function withEnv(values, run) {
    const saved = { COOKIE_SECURE: process.env.COOKIE_SECURE, DISCORD_REDIRECT_URI: process.env.DISCORD_REDIRECT_URI };
    Object.assign(process.env, values);
    try { run(); } finally { Object.assign(process.env, saved); }
}

test('an https redirect URI marks the session cookie secure without a second setting', () => {
    withEnv({ COOKIE_SECURE: '', DISCORD_REDIRECT_URI: 'https://panel.example/auth/callback' }, () => {
        assert.equal(cookieSecure(), true);
        assert.equal(cookieOptions(1000).secure, true);
    });
});

test('a plain http deployment keeps the flag off, or the owner is locked out', () => {
    withEnv({ COOKIE_SECURE: '', DISCORD_REDIRECT_URI: 'http://192.168.1.10:3001/auth/callback' }, () => {
        assert.equal(cookieSecure(), false);
        assert.equal(cookieOptions(1000).secure, false);
    });
});

test('COOKIE_SECURE overrides the derivation in both directions', () => {
    withEnv({ COOKIE_SECURE: 'true', DISCORD_REDIRECT_URI: 'http://192.168.1.10:3001/cb' }, () => {
        assert.equal(cookieSecure(), true);
    });
    withEnv({ COOKIE_SECURE: 'false', DISCORD_REDIRECT_URI: 'https://panel.example/cb' }, () => {
        assert.equal(cookieSecure(), false);
    });
});

test('the session cookie and the sign-in cookies never disagree', () => {
    const oauthCookies = require('./oauthCookies');
    withEnv({ COOKIE_SECURE: '', DISCORD_REDIRECT_URI: 'https://panel.example/cb' }, () => {
        assert.equal(cookieOptions(1000).secure, oauthCookies.options().secure);
    });
    withEnv({ COOKIE_SECURE: '', DISCORD_REDIRECT_URI: 'http://10.0.0.5:3001/cb' }, () => {
        assert.equal(cookieOptions(1000).secure, oauthCookies.options().secure);
    });
});
