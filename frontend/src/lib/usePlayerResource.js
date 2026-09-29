import { useEffect, useState } from 'react';

const INITIAL = {
    status: 'loading', // 'loading' | 'ready' | 'error' | 'unavailable'
    data: null,
    error: null,
    hint: null,
};

/**
 * Partial citizen record (vehicles, inventory, metadata); loader must be stable (api.js)
 * 501 = table missing in this schema: 'unavailable', never an empty list
 */
export function usePlayerResource(loader, citizenid, reloadToken = 0) {
    const [state, setState] = useState(INITIAL);

    useEffect(() => {
        if (!citizenid) return undefined;

        // An older answer must not overwrite a newer one after a reload
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
