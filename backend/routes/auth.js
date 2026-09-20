// backend/routes/auth.js
// Die vier Endpunkte des Anmeldevorgangs.
//
// /login und /callback sind Browser-Navigationen, keine XHR-Aufrufe: sie
// antworten mit Weiterleitungen. /me und /logout sind normale JSON-Routen.
const express = require('express');
const crypto = require('crypto');
const auth = require('../utils/auth');

const router = express.Router();

// Wohin nach Anmeldung oder Fehler zurueckgesprungen wird.
// Immer aus der eigenen Konfiguration, nie aus der Anfrage - sonst
// waere das hier eine offene Weiterleitung. Im Dev zeigt PANEL_URL auf den
// Vite-Server, im Betrieb liefert dasselbe Backend das Panel unter '/' aus.
const PANEL_URL = process.env.PANEL_URL || '/';

function panelRedirect(res, params) {
    const query = params ? `?${new URLSearchParams(params).toString()}` : '';
    res.redirect(`${PANEL_URL}${query}`);
}

// --- Wer bin ich ----------------------------------------------------------
// Die einzige Route, die das Frontend beim Start braucht. Antwortet immer
// mit 200, damit "nicht angemeldet" kein Fehlerfall im Frontend ist.
router.get('/api/auth/me', (req, res) => {
    if (!auth.ENABLED) {
        return res.json({
            authenticated: true,
            authDisabled: true,
            user: null,
            warning: 'Discord login is not configured - this panel is open to anyone who can reach it.'
        });
    }

    const session = auth.readSession(req);
    res.json({
        authenticated: Boolean(session),
        authDisabled: false,
        user: auth.publicUser(session),
        loginUrl: '/api/auth/login'
    });
});

// --- Anmeldung starten ----------------------------------------------------
router.get('/api/auth/login', (req, res) => {
    if (!auth.ENABLED) return panelRedirect(res);

    const { url, state } = auth.buildAuthorizeUrl();

    // Kurzlebiges Cookie, nur fuer den Rueckweg. 10 Minuten reichen fuer
    // den Discord-Dialog und lassen einen abgebrochenen Versuch verfallen.
    res.cookie(auth.STATE_COOKIE, state, auth.cookieOptions(10 * 60 * 1000));
    res.redirect(url);
});

// --- Rueckweg von Discord -------------------------------------------------
router.get('/api/auth/callback', async (req, res) => {
    if (!auth.ENABLED) return panelRedirect(res);

    const { code, state, error: oauthError } = req.query;

    // Der Nutzer hat im Discord-Dialog abgebrochen
    if (oauthError) {
        return panelRedirect(res, { auth: 'cancelled' });
    }

    const expected = req.cookies?.[auth.STATE_COOKIE];
    res.clearCookie(auth.STATE_COOKIE, { path: '/' });

    if (!code || !state || !expected) {
        return panelRedirect(res, { auth: 'error', reason: 'Incomplete callback from Discord.' });
    }

    // Zeitkonstanter Vergleich: der state ist ein Geheimnis auf Zeit.
    const a = Buffer.from(String(state));
    const b = Buffer.from(String(expected));
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        console.warn('[Auth] state mismatch on callback - request rejected');
        return panelRedirect(res, { auth: 'error', reason: 'Login request could not be verified. Please try again.' });
    }

    try {
        const accessToken = await auth.exchangeCode(code);
        const user = await auth.fetchDiscordUser(accessToken);
        const guild = await auth.fetchGuildRoles(accessToken);
        const verdict = auth.authorize(user, guild);

        if (!verdict.allowed) {
            console.warn(`[Auth] denied: ${user.username} (${user.id}) - ${verdict.reason}`);
            return panelRedirect(res, { auth: 'denied', reason: verdict.reason });
        }

        auth.issueSession(res, user, verdict.via);
        console.log(`[Auth] signed in: ${user.username} (${user.id}) via ${verdict.via}`);
        panelRedirect(res, { auth: 'ok' });

    } catch (e) {
        // Discord-Fehler gehoeren ins Log, nicht in die URL des Browsers
        console.error('[Auth] callback failed:', e.response?.data || e.message);
        panelRedirect(res, { auth: 'error', reason: 'Discord did not complete the login.' });
    }
});

// --- Abmelden -------------------------------------------------------------
router.post('/api/auth/logout', (req, res) => {
    auth.clearSession(res);
    res.json({ status: 'success', message: 'Signed out' });
});

module.exports = { router };
