// The two short-lived cookies of one sign-in attempt: the OAuth state and the surface to
// return to. Kept out of the route so the flags below are the only ones they can get.

const auth = require('./auth');

const SURFACE_COOKIE = 'veritas_oauth_surface';

// Return trip only; 10 min covers the Discord dialog, abandoned attempts expire
const MAX_AGE_MS = 10 * 60 * 1000;

/**
 * Whether these cookies are marked `secure`
 * Unset COOKIE_SECURE derives it from the redirect URI's scheme (BACKEND.md §5)
 */
function secure() {
    const configured = String(process.env.COOKIE_SECURE || '').trim().toLowerCase();
    if (configured === 'true') return true;
    if (configured === 'false') return false;

    // SECURITY: an https deployment gets the flag without a second setting; plain http keeps it
    // off, since a secure cookie never arrives over http://ip:3001 and would lock the owner out
    return String(process.env.DISCORD_REDIRECT_URI || '').trim().toLowerCase().startsWith('https://');
}

// SECURITY: httpOnly keeps the state out of document.cookie, so a script on the panel cannot
// read or replace it; sameSite lax still lets Discord's redirect carry the cookie back
function options() {
    return {
        httpOnly: true,
        sameSite: 'lax',
        secure: secure(),
        maxAge: MAX_AGE_MS,
        path: '/'
    };
}

/** Writes both cookies for one sign-in attempt */
function set(res, state, surface) {
    res.cookie(auth.STATE_COOKIE, state, options());
    res.cookie(SURFACE_COOKIE, surface, options());
}

/** @returns {string|null} the state this browser was given, or null */
function readState(req) {
    const value = req.cookies?.[auth.STATE_COOKIE];
    return typeof value === 'string' && value ? value : null;
}

/** @returns {'panel'|'portal'} the surface the sign-in started from; unknown values mean panel */
function readSurface(req) {
    return req.cookies?.[SURFACE_COOKIE] === 'portal' ? 'portal' : 'panel';
}

function clear(res) {
    res.clearCookie(auth.STATE_COOKIE, { path: '/' });
    res.clearCookie(SURFACE_COOKIE, { path: '/' });
}

module.exports = { SURFACE_COOKIE, MAX_AGE_MS, secure, options, set, readState, readSurface, clear };
