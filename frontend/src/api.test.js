// The login URL comes from the server and is assigned to window.location: same-origin only
// The request helpers are thin axios calls and stay untested; this is the guard around them

import { test, afterEach } from 'vitest';
import assert from 'node:assert/strict';

import { DEFAULT_LOGIN_URL, safeLoginUrl, startDiscordLogin } from './api';

afterEach(() => {
    delete globalThis.window;
});

const withWindow = () => {
    globalThis.window = { location: { href: '' } };
    return globalThis.window;
};

test('a same-origin path is kept', () => {
    assert.equal(safeLoginUrl('/api/auth/login'), '/api/auth/login');
    assert.equal(safeLoginUrl('  /api/auth/login  '), '/api/auth/login');
    assert.equal(safeLoginUrl('/api/auth/login?x=1'), '/api/auth/login?x=1');
});

test('a protocol-relative URL is refused: "//host" would leave the origin', () => {
    assert.equal(safeLoginUrl('//evil.example/login'), DEFAULT_LOGIN_URL);
    assert.equal(safeLoginUrl('  //evil.example/login'), DEFAULT_LOGIN_URL);
});

test('anything that is not a local path falls back to the default', () => {
    for (const value of ['https://evil.example', 'javascript:alert(1)', 'login', '', null, 7, {}]) {
        assert.equal(safeLoginUrl(value), DEFAULT_LOGIN_URL, JSON.stringify(value));
    }
});

test('the panel navigates to the plain login URL', () => {
    const win = withWindow();
    startDiscordLogin('/api/auth/login', 'panel');
    assert.equal(win.location.href, '/api/auth/login');
});

test('the portal flag is appended with the right separator', () => {
    const first = withWindow();
    startDiscordLogin('/api/auth/login', 'portal');
    assert.equal(first.location.href, '/api/auth/login?surface=portal');

    const second = withWindow();
    startDiscordLogin('/api/auth/login?next=/id', 'portal');
    assert.equal(second.location.href, '/api/auth/login?next=/id&surface=portal');
});

test('an unsafe login URL is replaced before the flag is added', () => {
    const win = withWindow();
    startDiscordLogin('//evil.example/login', 'portal');
    assert.equal(win.location.href, `${DEFAULT_LOGIN_URL}?surface=portal`);
});
