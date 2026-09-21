import { useCallback, useEffect, useState } from 'react';
import { fetchMyAccount, fetchMyBans } from '../api';

/**
 * Loading for Veritas ID.
 *
 * Deliberately not usePlayerResource: that one folds every failure into
 * "error" apart from 501, which is enough for the panel, where an admin can
 * read a raw message and know what to do with it. Here the HTTP status is
 * the whole message - 403 and 404 and 501 are three different sentences to
 * a player, and only one of them means anything is broken. So the code is
 * carried out of the hook and PortalNotice turns it into words.
 *
 * status:
 *   'loading' - the request is running
 *   'ready'   - it answered
 *   'failed'  - it did not, and `code` says how (null for a dead network)
 */

const INITIAL = { status: 'loading', data: null, error: null, hint: null, code: null };

function readFailure(err) {
    const body = err?.response?.data;
    const payload = body && typeof body === 'object' ? body : {};

    return {
        status: 'failed',
        data: null,
        error: typeof payload.error === 'string' && payload.error.trim()
            ? payload.error.trim()
            : (err?.message || 'Unknown error'),
        hint: typeof payload.hint === 'string' && payload.hint.trim() ? payload.hint.trim() : null,
        // No response at all means the network, not the server. Keeping that
        // as null instead of inventing a 500 is the difference between "the
        // server refused" and "nothing answered".
        code: err?.response?.status ?? null,
    };
}

/**
 * A request that is about the account rather than about one character, and
 * therefore takes no citizenid. `loader` and `label` have to be stable -
 * both are module constants at every call site.
 *
 * Shared rather than written out twice: two account-level requests reading
 * their answers by two slightly different rules is exactly how "failed"
 * and "empty" start to look alike somewhere down the line.
 */
function useAccountRequest(loader, label) {
    const [state, setState] = useState(INITIAL);
    const [attempt, setAttempt] = useState(0);

    useEffect(() => {
        // Against race conditions: a slower older answer must never
        // overwrite a newer one.
        let cancelled = false;

        loader()
            .then((res) => {
                if (cancelled) return;
                setState({
                    status: 'ready',
                    data: res.data && typeof res.data === 'object' ? res.data : {},
                    error: null,
                    hint: null,
                    code: null,
                });
            })
            .catch((err) => {
                if (cancelled) return;
                console.error(`Veritas ID ${label} request failed:`, err);
                setState(readFailure(err));
            });

        return () => { cancelled = true; };
    }, [loader, label, attempt]);

    // From a button, never from an effect: retrying on its own would turn a
    // dead backend into a request loop.
    const reload = useCallback(() => {
        setState(INITIAL);
        setAttempt((n) => n + 1);
    }, []);

    return { ...state, reload };
}

/** The signed-in account and its characters. */
export function usePortalAccount() {
    return useAccountRequest(fetchMyAccount, 'account');
}

/**
 * What txAdmin has on record against this account.
 *
 * 'ready' here means the request answered, not that the record was read:
 * the body carries `available`, and only the surface can decide what to do
 * with a "nobody looked" answer. The hook does not touch it.
 */
export function usePortalBans() {
    return useAccountRequest(fetchMyBans, 'ban record');
}

/**
 * One part of one character: the detail, the inventory or the vehicles.
 *
 * `loader` has to be stable - the helpers from api.js are. The character is
 * not switched underneath this hook: the character view is mounted with the
 * citizenid as its key, so a different character is a different component
 * and starts from 'loading' rather than showing the last one's data for a
 * frame.
 */
export function usePortalResource(loader, citizenid) {
    const [state, setState] = useState(INITIAL);
    const [attempt, setAttempt] = useState(0);

    useEffect(() => {
        if (!citizenid) return undefined;

        let cancelled = false;

        loader(citizenid)
            .then((res) => {
                if (cancelled) return;
                setState({
                    status: 'ready',
                    data: res.data && typeof res.data === 'object' ? res.data : {},
                    error: null,
                    hint: null,
                    code: null,
                });
            })
            .catch((err) => {
                if (cancelled) return;
                console.error('Veritas ID request failed:', err);
                setState(readFailure(err));
            });

        return () => { cancelled = true; };
    }, [loader, citizenid, attempt]);

    const reload = useCallback(() => {
        setState(INITIAL);
        setAttempt((n) => n + 1);
    }, []);

    return { ...state, reload };
}
