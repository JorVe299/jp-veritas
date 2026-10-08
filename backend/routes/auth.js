// Sign-in flow: /login and /callback answer with redirects, /me and /logout with JSON
const express = require('express');
const crypto = require('crypto');
const auth = require('../utils/auth');
const oauthCookies = require('../utils/oauthCookies');
const { charactersOf } = require('../utils/identity');
const { capabilitiesOf } = require('../utils/permissions');

const router = express.Router();

// SECURITY: return target from config only, never from the request (open redirect)
// Vite server in dev; empty in production (the backend serves the panel)
const PANEL_URL = process.env.PANEL_ORIGIN || '/';

// SECURITY: the request picks a key, never a path
const SURFACE_PATHS = { panel: '', portal: '/id' };

function panelRedirect(res, params, surface) {
    const query = params ? `?${new URLSearchParams(params).toString()}` : '';
    const base = PANEL_URL.endsWith('/') ? PANEL_URL.slice(0, -1) : PANEL_URL;
    res.redirect(`${base}${SURFACE_PATHS[surface] || '/'}${query}`);
}

// --- Who am I -------------------------------------------------------------
// Always 200: "not signed in" is not an error for the frontend
// Runs the live role check, so a waiting frontend picks up Discord role changes
router.get('/api/auth/me', async (req, res) => {
    if (!auth.ENABLED) {
        return res.json({
            authenticated: true,
            authDisabled: true,
            user: null,
            warning: 'Discord login is not configured - this panel is open to anyone who can reach it.'
        });
    }

    const { session, ended } = await auth.currentSession(req, res);
    res.json({
        authenticated: Boolean(session),
        authDisabled: false,
        user: auth.publicUser(session),
        loginUrl: '/api/auth/login',
        // Set only when the live check ended the session
        ended: ended || undefined
    });
});

// --- Start the sign-in ----------------------------------------------------
router.get('/api/auth/login', (req, res) => {
    if (!auth.ENABLED) return panelRedirect(res);

    const { url, state } = auth.buildAuthorizeUrl();

    // Return to the surface the sign-in started from (portal users land back on /id)
    const surface = req.query.surface === 'portal' ? 'portal' : 'panel';
    oauthCookies.set(res, state, surface);
    res.redirect(url);
});

// --- Return trip from Discord ---------------------------------------------
router.get('/api/auth/callback', async (req, res) => {
    if (!auth.ENABLED) return panelRedirect(res);

    // SECURITY: the authorization code arrives in the query because OAuth 2 puts it there; it is
    // single use, bound to the state cookie below, and exchanged server-side at once
    const { code, state, error: oauthError } = req.query;

    // Errors are reported on the surface the person started from
    const from = oauthCookies.readSurface(req);
    const expected = oauthCookies.readState(req);
    oauthCookies.clear(res);
    const back = (params, surface) => panelRedirect(res, params, surface || from);

    // Cancelled in the Discord dialog
    if (oauthError) {
        return back({ auth: 'cancelled' });
    }

    if (!code || !state || !expected) {
        return back({ auth: 'error', reason: 'Incomplete callback from Discord.' });
    }

    // SECURITY: constant-time compare of the OAuth state
    const a = Buffer.from(String(state));
    const b = Buffer.from(String(expected));
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        console.warn('[Auth] state mismatch on callback - request rejected');
        return back({ auth: 'error', reason: 'Login request could not be verified. Please try again.' });
    }

    try {
        const tokens = await auth.exchangeCode(code);
        const user = await auth.fetchDiscordUser(tokens.accessToken);
        const guild = await auth.fetchGuildRoles(tokens.accessToken);
        const verdict = auth.authorize(user, guild);

        // Two doors: a panel role opens the panel; guild member + character opens Veritas ID
        let portal = false;
        if (guild.member) {
            try {
                const own = await charactersOf(user.id);
                portal = Boolean(own && !own.unsupported && own.characters.length > 0);
            } catch (e) {
                // DB down must not downgrade to "no characters": fail the sign-in
                console.error('[Auth] character lookup failed during sign-in:', e.message);
                return back({ auth: 'error', reason: 'Could not reach the character database. Try again shortly.' });
            }
        }

        if (!verdict.allowed && !portal) {
            const reason = auth.GUILD_ID && !guild.member
                ? 'You are not a member of the Discord server for this community.'
                : 'This Discord account has no panel role and no character on this server.';
            console.warn(`[Auth] denied: ${user.username} (${user.id}) - ${reason}`);
            return back({ auth: 'denied', reason });
        }

        auth.issueSession(res, user, verdict.via || 'portal', verdict.role, portal, tokens);

        // Role without capabilities = no panel use; must match the frontend's rule
        const usesPanel = Boolean(verdict.role) && capabilitiesOf(verdict.role).length > 0;

        // Portal if the panel is unusable; else back to the start, unless the portal would 403
        const landing = (!usesPanel && portal) ? 'portal'
            : (from === 'portal' && portal ? 'portal' : 'panel');

        console.log(`[Auth] signed in: ${user.username} (${user.id}) role=${verdict.role || '-'} portal=${portal} -> ${landing}`);
        back({ auth: 'ok' }, landing);

    } catch (e) {
        // Discord errors belong in the log, not in the browser's URL
        console.error('[Auth] callback failed:', e.response?.data || e.message);
        back({ auth: 'error', reason: 'Discord did not complete the login.' });
    }
});

// --- Sign out -------------------------------------------------------------
router.post('/api/auth/logout', (req, res) => {
    auth.clearSession(res);
    res.json({ status: 'success', message: 'Signed out' });
});

module.exports = { router };
