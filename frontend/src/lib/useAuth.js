import { useCallback, useEffect, useRef, useState } from 'react';
import {
    DEFAULT_LOGIN_URL,
    fetchSession,
    onForbidden,
    onUnauthorized,
    safeLoginUrl,
    signOutRequest,
} from '../api';

// One state object: phase and session cannot drift apart
// notice is newer than the URL's sign-in feedback and takes precedence over it
const LOADING = { phase: 'loading', session: null, error: null, notice: null, reason: null };

const SIGNED_OUT = {
    authenticated: false,
    authDisabled: false,
    user: null,
    loginUrl: DEFAULT_LOGIN_URL,
    warning: null,
    ended: null,
};

// The backend re-checks the Discord role at most once a minute: faster polling gains nothing
const SESSION_POLL_MS = 60_000;

// Generic 401 text, not shown: the 'expired' notice says it better
const NOT_SIGNED_IN = 'Not signed in';

// Server text shown in the UI: capped as in authFeedback.js
const MAX_REASON = 300;

function readReason(value) {
    if (typeof value !== 'string') return null;
    const reason = value.trim().slice(0, MAX_REASON);
    return reason || null;
}

function endedNotice(reason) {
    return reason ? { notice: 'ended', reason } : { notice: 'expired', reason: null };
}

// Only losses count: a gain shows itself as an unlocked button
function lostCapability(before, after) {
    if (!Array.isArray(before?.capabilities)) return false;
    const now = new Set(Array.isArray(after?.capabilities) ? after.capabilities : []);
    return before.capabilities.some((id) => !now.has(id));
}

function hasCapabilities(user) {
    return Array.isArray(user?.capabilities) && user.capabilities.length > 0;
}

// Missing or malformed fields must never read as signed in
function readSession(data) {
    if (!data || typeof data !== 'object') return SIGNED_OUT;

    const authDisabled = data.authDisabled === true;
    const user = data.user && typeof data.user === 'object' ? data.user : null;
    const warning = typeof data.warning === 'string' ? data.warning.trim() : '';

    return {
        authenticated: data.authenticated === true,
        authDisabled,
        // Auth disabled: no user, even when authenticated is true
        user: authDisabled ? null : user,
        loginUrl: safeLoginUrl(data.loginUrl),
        warning: warning || null,
        // Set only when the server ended the session, never for a missing cookie
        ended: readReason(data.ended),
    };
}

function describe(err) {
    return err?.response?.data?.error || err?.message || 'Unknown error';
}

/**
 * App-wide session; phase: loading | ready | unreachable (never reported as signed out)
 * notice: expired (401) | ended (server's reason in noticeReason) | signed-out
 * A 401 anywhere signs out app-wide once; a 403 raises permissionNotice and refreshes
 */
export function useAuth() {
    const [state, setState] = useState(LOADING);
    const [checkToken, setCheckToken] = useState(0);
    const [signingOut, setSigningOut] = useState(false);
    const [permissionNotice, setPermissionNotice] = useState(false);
    // Concurrent 403s share one /auth/me call
    const refreshing = useRef(false);
    // Any session fetch resets the poll clock: no second ask right after a refresh
    const lastChecked = useRef(0);
    // Last rendered session for refresh(): a state updater after an await runs too late
    const current = useRef(null);

    useEffect(() => {
        // A slower, older answer must not overwrite a newer one
        let cancelled = false;

        fetchSession()
            .then((res) => {
                if (cancelled) return;
                lastChecked.current = Date.now();
                const session = readSession(res.data);
                // Ended by the server since the last visit: show the reason too
                const ended = !session.authenticated && session.ended
                    ? { notice: 'ended', reason: session.ended }
                    : { notice: null, reason: null };
                setState({ phase: 'ready', session, error: null, ...ended });
            })
            .catch((err) => {
                if (cancelled) return;
                console.error('Session check failed:', err);
                setState({ phase: 'unreachable', session: null, error: describe(err), notice: null, reason: null });
            });

        return () => { cancelled = true; };
    }, [checkToken]);

    const recheck = useCallback(() => {
        setState(LOADING);
        setPermissionNotice(false);
        setCheckToken((token) => token + 1);
    }, []);

    // Swaps the session in place; recheck() would drop the open sheet and write feedback
    // After a matrix save, a 403 and on the poll: the backend re-checks Discord roles there
    const refresh = useCallback(async () => {
        if (refreshing.current) return;
        refreshing.current = true;
        try {
            const res = await fetchSession();
            lastChecked.current = Date.now();
            const next = readSession(res.data);
            const lost = next.authenticated && lostCapability(current.current?.user, next.user);

            setState((prev) => {
                if (prev.phase !== 'ready') return prev;

                // Ended mid-work; an already signed-out state keeps its sign-in message
                if (!next.authenticated && prev.session?.authenticated) {
                    return { ...prev, session: next, ...endedNotice(next.ended) };
                }

                return { ...prev, session: next };
            });

            if (!next.authenticated) {
                setPermissionNotice(false);
            } else if (lost && hasCapabilities(next.user)) {
                // Role narrowed: raise the 403 banner early; not when none are left,
                // since that account moves to Veritas ID where the banner would linger
                setPermissionNotice(true);
            }
        } catch (err) {
            // On failure the state stays: claiming anything else would be worse
            console.error('Session refresh failed:', err);
        } finally {
            refreshing.current = false;
        }
    }, []);

    const dismissPermissionNotice = useCallback(() => setPermissionNotice(false), []);

    // 403: report once and refresh; the cards then re-read their permissions
    useEffect(() => onForbidden(() => {
        setPermissionNotice(true);
        refresh();
    }), [refresh]);

    // 401: body.error is the server's reason for ending the session, if it gave one
    useEffect(() => onUnauthorized((body) => {
        const said = readReason(body?.error);
        const reason = said && said !== NOT_SIGNED_IN ? said : null;
        setPermissionNotice(false);
        setState((prev) => {
            // Already signed out: a late 401 must not overwrite the sign-in message
            if (prev.phase === 'ready' && !prev.session?.authenticated) return prev;
            return {
                phase: 'ready',
                session: { ...SIGNED_OUT, loginUrl: prev.session?.loginUrl || DEFAULT_LOGIN_URL },
                error: null,
                ...endedNotice(reason),
            };
        });
    }), []);

    const session = state.session;

    useEffect(() => {
        current.current = session;
    }, [session]);

    // Nothing to poll when signed out, or without Discord: no role can change
    const polling = state.phase === 'ready'
        && session?.authenticated === true
        && session?.authDisabled !== true;

    // Role changes arrive without a new sign-in: once a minute while visible and on return,
    // never twice within the minute; idle while hidden
    // Timeout chain, not an interval: an ask on focus pushes the next tick back
    useEffect(() => {
        if (!polling) return undefined;

        let timer = null;

        const visible = () => document.visibilityState === 'visible';

        const stop = () => {
            clearTimeout(timer);
            timer = null;
        };

        const tick = () => {
            stop();
            if (!visible()) return;

            const waited = Date.now() - lastChecked.current;
            if (waited < SESSION_POLL_MS) {
                timer = setTimeout(tick, SESSION_POLL_MS - waited);
                return;
            }

            // Stamped now too: a focus event during a slow answer must not ask again
            lastChecked.current = Date.now();
            refresh();
            timer = setTimeout(tick, SESSION_POLL_MS);
        };

        const onVisibility = () => {
            if (visible()) tick();
            else stop();
        };

        // focus catches a return from another window; visibilitychange misses it
        document.addEventListener('visibilitychange', onVisibility);
        window.addEventListener('focus', onVisibility);
        tick();

        return () => {
            stop();
            document.removeEventListener('visibilitychange', onVisibility);
            window.removeEventListener('focus', onVisibility);
        };
    }, [polling, refresh]);

    const signOut = useCallback(async () => {
        setSigningOut(true);
        try {
            await signOutRequest();
            setPermissionNotice(false);
            setState({ phase: 'ready', session: SIGNED_OUT, error: null, notice: 'signed-out', reason: null });
        } catch (err) {
            // Unknown whether the session still stands: ask the server
            console.error('Sign-out failed:', err);
            recheck();
        } finally {
            setSigningOut(false);
        }
    }, [recheck]);

    return {
        phase: state.phase,
        error: state.error,
        notice: state.notice,
        // Server's reason for an 'ended' notice; null otherwise
        noticeReason: state.reason,
        authenticated: session?.authenticated === true,
        authDisabled: session?.authDisabled === true,
        user: session?.user ?? null,
        warning: session?.warning ?? null,
        loginUrl: session?.loginUrl || DEFAULT_LOGIN_URL,
        signingOut,
        signOut,
        recheck,
        refresh,
        permissionNotice,
        dismissPermissionNotice,
    };
}
