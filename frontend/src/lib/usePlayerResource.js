import { useEffect, useState } from 'react';

const INITIAL = {
    status: 'loading', // 'loading' | 'ready' | 'error' | 'unavailable'
    data: null,
    error: null,
    hint: null,
};

/**
 * Loads one partial record of a citizen (vehicles, inventory, metadata).
 *
 * The special case that shows up explicitly here: HTTP 501 does not mean
 * "empty" but "this table does not exist in this schema". Showing an empty
 * list would be a false statement at that point - instead the module signs
 * itself off as unavailable.
 *
 * `loader` has to be stable (the helpers from api.js are), otherwise the
 * effect runs again on every render.
 */
export function usePlayerResource(loader, citizenid, reloadToken = 0) {
    const [state, setState] = useState(INITIAL);

    useEffect(() => {
        if (!citizenid) return undefined;

        // Against race conditions: an older answer must not overwrite a
        // newer one after a reload.
        let cancelled = false;

        loader(citizenid)
            .then((res) => {
                if (cancelled) return;
                setState({ status: 'ready', data: res.data || {}, error: null, hint: null });
            })
            .catch((err) => {
                if (cancelled) return;
                const status = err.response?.status;
                const body = err.response?.data || {};
                setState({
                    status: status === 501 ? 'unavailable' : 'error',
                    data: null,
                    error: body.error || err.message,
                    hint: body.hint || null,
                });
            });

        return () => { cancelled = true; };
    }, [loader, citizenid, reloadToken]);

    return state;
}
