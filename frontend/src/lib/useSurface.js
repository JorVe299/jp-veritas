import { useSyncExternalStore } from 'react';

/**
 * Which of the two surfaces the address bar is asking for.
 *
 * There is no router here and there is deliberately not going to be one.
 * Two surfaces and one optional character id is the whole of it; a router
 * would be a dependency bought to hold three lines of string handling.
 *
 * The URL itself is the state. Nothing is copied into React, so there is no
 * second version of the truth that could drift: every read goes through
 * useSyncExternalStore, which re-renders on popstate (the back button) and
 * on our own pushState, which does not fire popstate and therefore
 * announces itself.
 */

export const PORTAL_PATH = '/id';

// Our own announcement for pushState/replaceState. A browser fires popstate
// only for history moves the user made, never for the ones we make.
const PATH_EVENT = 'veritas:pathchange';

function subscribe(onChange) {
    window.addEventListener('popstate', onChange);
    window.addEventListener(PATH_EVENT, onChange);
    return () => {
        window.removeEventListener('popstate', onChange);
        window.removeEventListener(PATH_EVENT, onChange);
    };
}

function readPath() {
    return window.location.pathname || '/';
}

// Never rendered on a server, but useSyncExternalStore insists on the third
// argument in a strict build, and "/" is the honest answer without a window.
function readServerPath() {
    return '/';
}

/** The current pathname, re-read whenever it changes. */
export function usePath() {
    return useSyncExternalStore(subscribe, readPath, readServerPath);
}

/**
 * 'portal' for /id and everything below it, 'panel' for the rest.
 *
 * The comparison is exact plus a trailing slash on purpose: /identity is a
 * path that belongs to nobody yet, and it must not fall into the portal
 * just because it starts with the same three characters.
 */
export function surfaceFor(pathname) {
    const path = typeof pathname === 'string' ? pathname : '/';
    return path === PORTAL_PATH || path.startsWith(`${PORTAL_PATH}/`) ? 'portal' : 'panel';
}

/**
 * The character id out of /id/<citizenid>, or null on /id itself.
 *
 * Anything deeper is ignored rather than refused: a stray trailing segment
 * should land on the character, not on an error page.
 */
export function characterIdFor(pathname) {
    if (surfaceFor(pathname) !== 'portal') return null;

    const rest = String(pathname).slice(PORTAL_PATH.length).replace(/^\//, '');
    const first = rest.split('/')[0];
    if (!first) return null;

    try {
        return decodeURIComponent(first);
    } catch {
        // A half-written escape sequence in the address bar. Take it as
        // typed; the server will answer 404 for it, which is the truth.
        return first;
    }
}

/** /id/<citizenid>, with the id encoded - it sits in a path segment. */
export function characterPath(citizenid) {
    return `${PORTAL_PATH}/${encodeURIComponent(String(citizenid))}`;
}

/**
 * Go somewhere. `replace` is for corrections the user did not ask for -
 * those must not become a history entry, or the back button would bounce
 * off the redirect instead of leaving.
 */
export function navigate(to, { replace = false } = {}) {
    const target = typeof to === 'string' && to.startsWith('/') && !to.startsWith('//') ? to : '/';
    if (target === readPath()) return;

    try {
        if (replace) window.history.replaceState(window.history.state, '', target);
        else window.history.pushState(null, '', target);
    } catch {
        // pushState can fail on exotic origins (file://). A hard navigation
        // still gets there - the backend serves index.html for any path.
        window.location.href = target;
        return;
    }

    window.dispatchEvent(new Event(PATH_EVENT));
}
