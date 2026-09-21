import { useCallback, useEffect, useRef, useState } from 'react';
import {
    DEFAULT_LOGIN_URL,
    fetchSession,
    onForbidden,
    onUnauthorized,
    safeLoginUrl,
    signOutRequest,
} from '../api';

// A single state object instead of many separate states, so that phase and
// session cannot drift apart.
//
// phase:
//   'loading'     - /api/auth/me is still running. Show neither panel nor login.
//   'ready'       - the server has answered, the session holds.
//   'unreachable' - /api/auth/me itself went down. That is expressly
//                   not "not signed in": that would be a false statement.
//
// notice: what happened last in this session - 'expired' (a 401 in the middle
// of the work) or 'signed-out' (signed out on purpose). Both are newer than
// the feedback from the address bar and therefore take precedence: otherwise
// the last sign-in attempt's message would stand there again after signing out.
const LOADING = { phase: 'loading', session: null, error: null, notice: null };

const SIGNED_OUT = {
    authenticated: false,
    authDisabled: false,
    user: null,
    loginUrl: DEFAULT_LOGIN_URL,
    warning: null,
};

// Read the answer defensively: missing, empty or broken fields must never
// accidentally pass as "signed in".
function readSession(data) {
    if (!data || typeof data !== 'object') return SIGNED_OUT;

    const authDisabled = data.authDisabled === true;
    const user = data.user && typeof data.user === 'object' ? data.user : null;
    const warning = typeof data.warning === 'string' ? data.warning.trim() : '';

    return {
        authenticated: data.authenticated === true,
        authDisabled,
        // Without a Discord configuration there is no signed-in user,
        // even when authenticated reports true.
        user: authDisabled ? null : user,
        loginUrl: safeLoginUrl(data.loginUrl),
        warning: warning || null,
    };
}

function describe(err) {
    return err?.response?.data?.error || err?.message || 'Unknown error';
}

/**
 * Holds the sign-in state of the whole app.
 *
 * The 401 interceptor in api.js knows nothing of React; it reports here via
 * onUnauthorized(), and that becomes "signed out, session expired" here.
 * That way the app falls back to the sign-in screen as a whole, instead of
 * every module showing an error of its own.
 */
export function useAuth() {
    const [state, setState] = useState(LOADING);
    // Counting up makes the session be checked again.
    const [checkToken, setCheckToken] = useState(0);
    const [signingOut, setSigningOut] = useState(false);
    // A permission was pulled out from under the work in progress.
    const [permissionNotice, setPermissionNotice] = useState(false);
    // Keeps a handful of simultaneous 403s from triggering a handful of
    // /auth/me calls - one answer is enough for all of them.
    const refreshing = useRef(false);

    useEffect(() => {
        // cancelled guards against race conditions: a slower older answer
        // must not overwrite the newer one.
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
        setPermissionNotice(false);
        setCheckToken((token) => token + 1);
    }, []);

    /**
     * Reload the session without clearing the surface away.
     *
     * recheck() switches to 'loading' and throws the whole panel away with
     * it - right at startup, wrong mid-work: the sheet currently open would
     * close, and the write whose feedback is still standing there would be
     * out of sight. Here only the content of the session is replaced; the
     * phase stays.
     *
     * Needed after the permission matrix has been saved, and after a 403
     * has shown that one's own list is out of date.
     */
    const refresh = useCallback(async () => {
        if (refreshing.current) return;
        refreshing.current = true;
        try {
            const res = await fetchSession();
            setState((prev) => (prev.phase === 'ready'
                ? { ...prev, session: readSession(res.data) }
                : prev));
        } catch (err) {
            // Failure here only means: the state stays as it was.
            // Claiming anything else would be worse than nothing.
            console.error('Session refresh failed:', err);
        } finally {
            refreshing.current = false;
        }
    }, []);

    const dismissPermissionNotice = useCallback(() => setPermissionNotice(false), []);

    // Global 403 handling: a permission can be taken away while you are
    // working with it. Report once, reload the session - after that the UI
    // tidies itself up, because the cards re-read their permissions.
    useEffect(() => onForbidden(() => {
        setPermissionNotice(true);
        refresh();
    }), [refresh]);

    // Global 401 handling: sign in once, for as long as the app is running.
    useEffect(() => onUnauthorized(() => {
        setState((prev) => {
            // Already signed out: touch nothing, otherwise a 401 trickling
            // in later would overwrite the sign-in attempt's message.
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
            setPermissionNotice(false);
            setState({ phase: 'ready', session: SIGNED_OUT, error: null, notice: 'signed-out' });
        } catch (err) {
            // Sign-out failed: do not guess whether the session still
            // stands, ask the server instead.
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
        refresh,
        permissionNotice,
        dismissPermissionNotice,
    };
}
