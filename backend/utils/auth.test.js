// backend/utils/auth.test.js
//
// The portal flag is decided once, at sign-in, and carried in the cookie.
// That makes one case easy to get wrong: a session minted before Veritas ID
// existed has no flag at all, and reading that absence as "not allowed"
// tells someone their account is barred when in fact nobody ever asked.
// It also hides the way in, because the panel only offers the link to
// accounts it believes belong there - so the feature vanishes silently.
//
// These pin down the three states a session can be in.

const test = require('node:test');
const assert = require('node:assert');

const { publicUser } = require('./auth');

const BASE = { sub: '111111111111111111', username: 'someone', globalName: 'Someone', avatar: null, via: 'user' };

test('a session from before Veritas ID is not a denial', () => {
    const user = publicUser({ ...BASE, role: 'owner' });
    assert.equal(user.portal, false, 'it cannot claim access nobody granted');
    assert.equal(user.portalKnown, false, 'but it must be visible that the question was never asked');
});

test('a fresh session that was refused the portal says so definitively', () => {
    const user = publicUser({ ...BASE, role: 'administrator', portal: false });
    assert.equal(user.portal, false);
    assert.equal(user.portalKnown, true, 'false is an answer, and must not read as a stale cookie');
});

test('a fresh session with the portal carries both', () => {
    const user = publicUser({ ...BASE, role: null, portal: true });
    assert.equal(user.portal, true);
    assert.equal(user.portalKnown, true);
});

test('the panel offers the way in for exactly the right sessions', () => {
    // The condition App.jsx uses. Written out here because getting it wrong
    // does not break anything visibly - it just removes the only door.
    const offersLink = (u) => u.portal === true || u.portalKnown === false;

    assert.equal(offersLink(publicUser({ ...BASE, role: null, portal: true })), true, 'a portal user');
    assert.equal(offersLink(publicUser({ ...BASE, role: 'owner' })), true, 'a session that predates the flag');
    assert.equal(offersLink(publicUser({ ...BASE, role: 'administrator', portal: false })), false,
        'staff with no character are not sent to a page that will refuse them');
});

test('no session at all is still nothing', () => {
    assert.equal(publicUser(null), null);
});

test('a roleless session gets no capabilities and no role label', () => {
    // The other half of the same idea: holding no panel role must never
    // fall through into holding every panel permission.
    const user = publicUser({ ...BASE, role: null, portal: true });
    assert.equal(user.role, null);
    assert.equal(user.roleLabel, null);
    assert.deepEqual(user.capabilities, []);
});
