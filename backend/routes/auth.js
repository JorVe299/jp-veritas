// backend/routes/auth.js
// The four endpoints of the sign-in flow.
//
// /login and /callback are browser navigations, not XHR calls: they answer
// with redirects. /me and /logout are ordinary JSON routes.
const express = require('express');
const crypto = require('crypto');
const auth = require('../utils/auth');
const { charactersOf } = require('../utils/identity');
const { capabilitiesOf } = require('../utils/permissions');

const router = express.Router();

// Where to return after signing in or failing. Always from our own
// configuration, never from the request - otherwise this would be an open
// redirect.
// The same variable as for CORS: the Vite server in dev, empty in
// production, where the same backend serves the panel under '/'.
const PANEL_URL = process.env.PANEL_ORIGIN || '/';

// The two surfaces this installation serves, and the only two paths a
// sign-in can return to. The request picks a KEY from this table; it never
// supplies a path of its own, which is what keeps this from turning into
// an open redirect.
const SURFACE_PATHS = { panel: '', portal: '/id' };
const SURFACE_COOKIE = 'veritas_oauth_surface';

function panelRedirect(res, params, surface) {
    const query = params ? `?${new URLSearchParams(params).toString()}` : '';
    const base = PANEL_URL.endsWith('/') ? PANEL_URL.slice(0, -1) : PANEL_URL;
    res.redirect(`${base}${SURFACE_PATHS[surface] || '/'}${query}`);
}

// --- Who am I -------------------------------------------------------------
// The only route the frontend needs at startup. Always answers with 200 so
// that "not signed in" is not an error case in the frontend.
// Also the place a waiting frontend picks up a role changed in Discord: it
// runs the same live check as every other route (see currentSession).
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
        // Why a session that existed a moment ago does not any more. Only
        // set when the live check ended it, never for plain "not signed in".
        ended: ended || undefined
    });
});

// --- Start the sign-in ----------------------------------------------------
router.get('/api/auth/login', (req, res) => {
    if (!auth.ENABLED) return panelRedirect(res);

    const { url, state } = auth.buildAuthorizeUrl();

    // Where this sign-in started. A citizen who opens Veritas ID and signs
    // in has to come back to Veritas ID - without this they land on the
    // admin panel for a moment and are bounced from there.
    const surface = req.query.surface === 'portal' ? 'portal' : 'panel';
    res.cookie(SURFACE_COOKIE, surface, auth.cookieOptions(10 * 60 * 1000));

    // Short-lived cookie, only for the return trip. Ten minutes is enough
    // for the Discord dialog and lets an abandoned attempt expire.
    res.cookie(auth.STATE_COOKIE, state, auth.cookieOptions(10 * 60 * 1000));
    res.redirect(url);
});

// --- Return trip from Discord ---------------------------------------------
router.get('/api/auth/callback', async (req, res) => {
    if (!auth.ENABLED) return panelRedirect(res);

    const { code, state, error: oauthError } = req.query;

    // Read back where this started, and answer there from here on - a
    // failure has to be reported on the surface the person is looking at.
    // An unknown value falls back to the panel rather than being trusted.
    const from = req.cookies?.[SURFACE_COOKIE] === 'portal' ? 'portal' : 'panel';
    res.clearCookie(SURFACE_COOKIE, { path: '/' });
    const back = (params, surface) => panelRedirect(res, params, surface || from);

    // The user cancelled in the Discord dialog
    if (oauthError) {
        return back({ auth: 'cancelled' });
    }

    const expected = req.cookies?.[auth.STATE_COOKIE];
    res.clearCookie(auth.STATE_COOKIE, { path: '/' });

    if (!code || !state || !expected) {
        return back({ auth: 'error', reason: 'Incomplete callback from Discord.' });
    }

    // Constant-time comparison: the state is a secret with a short life.
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

        // Two separate doors. A panel role opens the admin panel; being a
        // member of the Discord with at least one character opens Veritas
        // ID. Most people have exactly one of the two, some have both, and
        // whoever has neither is turned away.
        let portal = false;
        if (guild.member) {
            try {
                const own = await charactersOf(user.id);
                portal = Boolean(own && !own.unsupported && own.characters.length > 0);
            } catch (e) {
                // A database that is down must not silently downgrade
                // someone to "no characters" - say so instead.
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

        // Where this account can actually get to work. Holding a role is
        // not the same as being able to use the panel: a role whose
        // capabilities have all been taken away reaches nothing there. The
        // frontend draws the same line, and the two have to agree or one
        // will bounce what the other just sent.
        const usesPanel = Boolean(verdict.role) && capabilitiesOf(verdict.role).length > 0;

        // Someone who cannot use the panel goes to Veritas ID whichever
        // door they came through, provided they can use that. Everyone else
        // returns to where they started - unless that was Veritas ID and
        // they cannot use it, which would land them on their own 403.
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
