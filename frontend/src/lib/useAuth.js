import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_LOGIN_URL, fetchSession, onUnauthorized, safeLoginUrl, signOutRequest } from '../api';

// Ein einziges Zustandsobjekt statt vieler Einzel-States, damit Phase und
// Sitzung nicht auseinander laufen koennen.
//
// phase:
//   'loading'     - /api/auth/me laeuft noch. Weder Panel noch Login zeigen.
//   'ready'       - der Server hat geantwortet, session gilt.
//   'unreachable' - /api/auth/me selbst ist ausgefallen. Das ist ausdruecklich
//                   nicht "nicht angemeldet": das waere eine Falschaussage.
//
// notice: was in dieser Sitzung zuletzt passiert ist - 'expired' (401 mitten
// in der Arbeit) oder 'signed-out' (selbst abgemeldet). Beides ist juenger
// als die Rueckmeldung aus der Adresszeile und hat deshalb Vorrang: sonst
// stuende nach dem Abmelden wieder die Meldung des letzten Anmeldeversuchs da.
const LOADING = { phase: 'loading', session: null, error: null, notice: null };

const SIGNED_OUT = {
    authenticated: false,
    authDisabled: false,
    user: null,
    loginUrl: DEFAULT_LOGIN_URL,
    warning: null,
};

// Die Antwort defensiv lesen: fehlende, leere oder kaputte Felder duerfen
// niemals versehentlich als "angemeldet" durchgehen.
function readSession(data) {
    if (!data || typeof data !== 'object') return SIGNED_OUT;

    const authDisabled = data.authDisabled === true;
    const user = data.user && typeof data.user === 'object' ? data.user : null;
    const warning = typeof data.warning === 'string' ? data.warning.trim() : '';

    return {
        authenticated: data.authenticated === true,
        authDisabled,
        // Ohne Discord-Konfiguration gibt es keinen angemeldeten Nutzer,
        // auch wenn authenticated true meldet.
        user: authDisabled ? null : user,
        loginUrl: safeLoginUrl(data.loginUrl),
        warning: warning || null,
    };
}

function describe(err) {
    return err?.response?.data?.error || err?.message || 'Unknown error';
}

/**
 * Haelt den Anmeldezustand der ganzen App.
 *
 * Der 401-Interceptor in api.js kennt React nicht; er meldet ueber
 * onUnauthorized() hierher, und hier wird daraus "abgemeldet, Sitzung
 * abgelaufen". So faellt die App geschlossen auf den Anmeldebildschirm,
 * statt dass jedes Modul einzeln einen Fehler zeigt.
 */
export function useAuth() {
    const [state, setState] = useState(LOADING);
    // Hochzaehlen laesst die Sitzung neu pruefen.
    const [checkToken, setCheckToken] = useState(0);
    const [signingOut, setSigningOut] = useState(false);

    useEffect(() => {
        // cancelled schuetzt vor Race Conditions: eine langsamere aeltere
        // Antwort darf die neuere nicht ueberschreiben.
        let cancelled = false;

        fetchSession()
            .then((res) => {
                if (cancelled) return;
                setState({ phase: 'ready', session: readSession(res.data), error: null, notice: null });
            })
            .catch((err) => {
                if (cancelled) return;
                console.error('Session check failed:', err);
                setState({ phase: 'unreachable', session: null, error: describe(err), notice: null });
            });

        return () => { cancelled = true; };
    }, [checkToken]);

    const recheck = useCallback(() => {
        setState(LOADING);
        setCheckToken((token) => token + 1);
    }, []);

    // Globale 401-Behandlung: einmal anmelden, solange die App laeuft.
    useEffect(() => onUnauthorized(() => {
        setState((prev) => {
            // Schon abgemeldet: nichts anfassen, sonst ueberschreibt ein
            // spaeter eintrudelnder 401 die Meldung des Anmeldeversuchs.
            if (prev.phase === 'ready' && !prev.session?.authenticated) return prev;
            return {
                phase: 'ready',
                session: { ...SIGNED_OUT, loginUrl: prev.session?.loginUrl || DEFAULT_LOGIN_URL },
                error: null,
                notice: 'expired',
            };
        });
    }), []);

    const signOut = useCallback(async () => {
        setSigningOut(true);
        try {
            await signOutRequest();
            setState({ phase: 'ready', session: SIGNED_OUT, error: null, notice: 'signed-out' });
        } catch (err) {
            // Abmelden fehlgeschlagen: nicht raten, ob die Sitzung noch
            // steht, sondern den Server fragen.
            console.error('Sign-out failed:', err);
            recheck();
        } finally {
            setSigningOut(false);
        }
    }, [recheck]);

    const session = state.session;

    return {
        phase: state.phase,
        error: state.error,
        notice: state.notice,
        authenticated: session?.authenticated === true,
        authDisabled: session?.authDisabled === true,
        user: session?.user ?? null,
        warning: session?.warning ?? null,
        loginUrl: session?.loginUrl || DEFAULT_LOGIN_URL,
        signingOut,
        signOut,
        recheck,
    };
}
