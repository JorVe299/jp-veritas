import { useCallback, useEffect, useState } from 'react';
import { fetchMyAccount, fetchMyBans } from '../api';

// status loading | ready | failed; failed keeps the HTTP `code` for PortalNotice to word
// Not usePlayerResource: to a player 403, 404 and 501 are different sentences

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
        // null, not an invented 500: "nothing answered" is not "the server refused"
        code: err?.response?.status ?? null,
    };
}

// Account-level request; loader and label must be stable (module constants)
// Shared so both requests read answers by one rule: "failed" must never look "empty"
function useAccountRequest(loader, label) {
    const [state, setState] = useState(INITIAL);
    const [attempt, setAttempt] = useState(0);

    useEffect(() => {
        // A slower, older answer must never overwrite a newer one
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

    // Button-only, never from an effect: auto-retry turns a dead backend into a request loop
    const reload = useCallback(() => {
        setState(INITIAL);
        setAttempt((n) => n + 1);
    }, []);

    return { ...state, reload };
}

/** Signed-in account with its characters */
export function usePortalAccount() {
    return useAccountRequest(fetchMyAccount, 'account');
}

/**
 * txAdmin's record on this account; 'ready' means answered, not read
 * `available` in the body passes through untouched: the surface judges it
 */
export function usePortalBans() {
    return useAccountRequest(fetchMyBans, 'ban record');
}

/**
 * One part of a character (detail, inventory, vehicles); loader must be stable (api.js)
 * No reset on citizenid change: the view is keyed by citizenid, so a new one remounts
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
