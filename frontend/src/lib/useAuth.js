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
// of the work), 'ended' (the server ended the session on purpose and said
// why - the sentence is in `reason`) or 'signed-out' (signed out on purpose).
// All of them are newer than the feedback from the address bar and therefore
// take precedence: otherwise the last sign-in attempt's message would stand
// there again after signing out.
const LOADING = { phase: 'loading', session: null, error: null, notice: null, reason: null };

const SIGNED_OUT = {
    authenticated: false,
    authDisabled: false,
    user: null,
    loginUrl: DEFAULT_LOGIN_URL,
    warning: null,
    ended: null,
};

// How often the session is asked again while the tab is in view. The backend
// re-checks the Discord role at most once a minute per user, so asking more
// often would only ever hear the same answer twice.
const SESSION_POLL_MS = 60_000;

// The generic 401 sentence for a missing or expired cookie. It says nothing
// the 'expired' notice does not already say better, so it is not shown.
const NOT_SIGNED_IN = 'Not signed in';

// The reason text comes from the server and gets displayed. Capped for the
// same reason as the one in authFeedback.js: a runaway message must not blow
// up the layout.
const MAX_REASON = 300;

function readReason(value) {
    if (typeof value !== 'string') return null;
    const reason = value.trim().slice(0, MAX_REASON);
    return reason || null;
}

// The notice for a session that has just gone away. With a reason from the
// server it is 'ended' and carries it; without one it is the plain 'expired'
// it always was.
function endedNotice(reason) {
    return reason ? { notice: 'ended', reason } : { notice: 'expired', reason: null };
}

// Whether a capability the user held before is missing from the new list.
// Only a loss is worth a word: a gain shows up by itself, as a button that
// is no longer locked.
function lostCapability(before, after) {
    if (!Array.isArray(before?.capabilities)) return false;
    const now = new Set(Array.isArray(after?.capabilities) ? after.capabilities : []);
    return before.capabilities.some((id) => !now.has(id));
}

function hasCapabilities(user) {
    return Array.isArray(user?.capabilities) && user.capabilities.length > 0;
}

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
        // Only present when the server ended the session itself - never
        // for a cookie that simply is not there.
        ended: readReason(data.ended),
    };
}

function describe(err) {
    return err?.response?.data?.error || err?.message || 'Unknown error';
}

/**
 * Holds the sign-in state of the whole app.
 *
 * The 401 interceptor in api.js knows nothing of React; it reports here via
 * onUnauthorized(), and that becomes "signed out, session expired" here - or
 * "session ended", with the server's reason, when it gave one. That way the
 * app falls back to the sign-in screen as a whole, instead of every module
 * showing an error of its own.
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
    // When the session was last asked for, by whichever path. The poll
    // below counts from here, so a refresh after a 403 or a saved matrix
    // resets the clock rather than being followed by a second one.
    const lastChecked = useRef(0);
    // The session as last rendered, for refresh() to compare a new answer
    // against. A state updater cannot be used for that: after an await it
    // runs later, during the render, not when refresh() asks.
    const current = useRef(null);

    useEffect(() => {
        // cancelled guards against race conditions: a slower older answer
        // must not overwrite the newer one.
        let cancelled = false;

        fetchSession()
            .then((res) => {
                if (cancelled) return;
                lastChecked.current = Date.now();
                const session = readSession(res.data);
                // A session the server ended since the last visit - after
                // the deploy that introduced the check, that is everyone,
                // once. The reason is worth showing then, too.
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

    /**
     * Reload the session without clearing the surface away.
     *
     * recheck() switches to 'loading' and throws the whole panel away with
     * it - right at startup, wrong mid-work: the sheet currently open would
     * close, and the write whose feedback is still standing there would be
     * out of sight. Here only the content of the session is replaced; the
     * phase stays.
     *
     * Needed after the permission matrix has been saved, after a 403 has
     * shown that one's own list is out of date, and on the poll below: the
     * backend re-checks the Discord role on these calls, so this is how a
     * role change arrives without signing in again.
     *
     * If the answer is "not signed in", the session was ended underneath
     * the work - by the server's role check or simply by time - and the app
     * falls back to the sign-in screen with the reason, the same way a 401
     * does.
     */
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

                // Signed in a moment ago, not any more: the session ended
                // mid-work. An already signed-out state is left alone, or
                // the sign-in screen's message would be overwritten.
                if (!next.authenticated && prev.session?.authenticated) {
                    return { ...prev, session: next, ...endedNotice(next.ended) };
                }

                return { ...prev, session: next };
            });

            if (!next.authenticated) {
                setPermissionNotice(false);
            } else if (lost && hasCapabilities(next.user)) {
                // A role narrowed from Discord or in the matrix: the same
                // banner a 403 would have raised, only before the 403. Not
                // when nothing is left: such an account is moved over to
                // Veritas ID, and the banner would only lie in wait there
                // for it to come back.
                setPermissionNotice(true);
            }
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
    // The body's `error` says why when the server ended the session on
    // purpose; the generic "Not signed in" adds nothing to 'expired'.
    useEffect(() => onUnauthorized((body) => {
        const said = readReason(body?.error);
        const reason = said && said !== NOT_SIGNED_IN ? said : null;
        setPermissionNotice(false);
        setState((prev) => {
            // Already signed out: touch nothing, otherwise a 401 trickling
            // in later would overwrite the sign-in attempt's message.
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

    // Only a live, real session is worth keeping current. On the sign-in
    // screen there is nothing to re-check, and without Discord there is no
    // role that could change.
    const polling = state.phase === 'ready'
        && session?.authenticated === true
        && session?.authDisabled !== true;

    // Keep the session current without anyone pressing anything: a Discord
    // role change otherwise only arrived with the next sign-in. Once a
    // minute while the tab is in view, and once on coming back to it - but
    // never twice within the minute, whichever of the two asks. While the
    // tab is hidden nothing runs at all: nobody is looking, and the first
    // look back asks anyway.
    //
    // A chain of timeouts rather than an interval, so that a focus that has
    // just asked moves the next tick instead of an interval firing a moment
    // after it.
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

            // refresh() stamps lastChecked when the answer lands; stamping
            // here as well keeps a slow answer from letting a focus event
            // ask a second time in the meantime.
            lastChecked.current = Date.now();
            refresh();
            timer = setTimeout(tick, SESSION_POLL_MS);
        };

        const onVisibility = () => {
            if (visible()) tick();
            else stop();
        };

        // focus covers coming back from another window while the tab never
        // stopped being visible, which visibilitychange does not see.
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
            // Sign-out failed: do not guess whether the session still
            // stands, ask the server instead.
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
        // The server's sentence behind an 'ended' notice; null otherwise.
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
