// backend/utils/auth.test.js
//
// The portal flag travels in the cookie: it is decided at sign-in and kept
// current by the live role check. What reaches the frontend has to read it
// strictly - only an explicit true opens Veritas ID, and holding no panel
// role must never fall through into holding panel permissions.

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
    // Anything but an explicit true is no. A missing field must not read
    // as access nobody granted.
    const user = publicUser({ ...BASE, role: 'owner' });
    assert.equal(user.portal, false);
});

test('the panel offers the way in for exactly the right sessions', () => {
    // The condition App.jsx uses. Written out here because getting it wrong
    // does not break anything visibly - it just removes the only door.
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
    // The other half of the same idea: holding no panel role must never
    // fall through into holding every panel permission.
    const user = publicUser({ ...BASE, role: null, portal: true });
    assert.equal(user.role, null);
    assert.equal(user.roleLabel, null);
    assert.deepEqual(user.capabilities, []);
});
