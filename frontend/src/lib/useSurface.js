import { useSyncExternalStore } from 'react';

// No router on purpose: two surfaces and one optional id do not justify the dependency
// The URL is the state, never copied into React; reads go through useSyncExternalStore

export const PORTAL_PATH = '/id';

// pushState/replaceState fire no popstate: announced through this event
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

// No SSR, but useSyncExternalStore requires getServerSnapshot in a strict build
function readServerPath() {
    return '/';
}

export function usePath() {
    return useSyncExternalStore(subscribe, readPath, readServerPath);
}

/**
 * 'portal' for /id and below, else 'panel'
 * Exact or with a slash: a prefix match would pull /identity into the portal
 */
export function surfaceFor(pathname) {
    const path = typeof pathname === 'string' ? pathname : '/';
    return path === PORTAL_PATH || path.startsWith(`${PORTAL_PATH}/`) ? 'portal' : 'panel';
}

/** /id/<citizenid> -> id, /id -> null; deeper segments ignored: land on the character */
export function characterIdFor(pathname) {
    if (surfaceFor(pathname) !== 'portal') return null;

    const rest = String(pathname).slice(PORTAL_PATH.length).replace(/^\//, '');
    const first = rest.split('/')[0];
    if (!first) return null;

    try {
        return decodeURIComponent(first);
    } catch {
        // Malformed escape: taken as typed; the server answers 404
        return first;
    }
}

export function characterPath(citizenid) {
    return `${PORTAL_PATH}/${encodeURIComponent(String(citizenid))}`;
}

/** replace: for unrequested corrections, so Back leaves instead of bouncing off them */
export function navigate(to, { replace = false } = {}) {
    const target = typeof to === 'string' && to.startsWith('/') && !to.startsWith('//') ? to : '/';
    if (target === readPath()) return;

    try {
        if (replace) window.history.replaceState(window.history.state, '', target);
        else window.history.pushState(null, '', target);
    } catch {
        // pushState can throw (file://); the backend serves index.html for any path
        window.location.href = target;
        return;
    }

    window.dispatchEvent(new Event(PATH_EVENT));
}
