import { useEffect, useState } from 'react';

// Failure states stay distinct, each worded differently: 501 unavailable (table missing;
// never an empty list), 502 unreachable (bridge silent, database fine), forbidden (role may
// not; nothing loaded), error (anything else, network failures included)

const INITIAL = {
    status: 'loading', // 'loading' | 'ready' | 'error' | 'unavailable' | 'unreachable'
    data: null,
    error: null,
    hint: null,
    query: null, // null = no answer has arrived yet
};

const FORBIDDEN = { ...INITIAL, status: 'forbidden' };

// Backend failures are { error, hint }
function describe(err) {
    const code = err?.response?.status;
    const body = err?.response?.data || {};

    return {
        status: code === 501 ? 'unavailable' : code === 502 ? 'unreachable' : 'error',
        data: null,
        // Bridge diagnostic sends `message`, schema check `detail`; err.message explains nothing
        error: body.error || body.message || err?.message || 'The server did not answer.',
        hint: body.hint || body.detail || null,
    };
}

/**
 * One request, no search; `load` must be stable (api.js helpers are)
 * Bump `token` to reload; the old answer stays until the new one lands: no blank card
 */
export function useServerFetch(load, { enabled = true, token = 0 } = {}) {
    const [state, setState] = useState(INITIAL);

    useEffect(() => {
        if (!enabled) return undefined;

        // A slower, older answer must not overwrite a newer one
        let cancelled = false;

        load()
            .then((answer) => {
                if (cancelled) return;
                setState({
                    status: 'ready',
                    data: answer.data || {},
                    error: null,
                    hint: null,
                    query: 'done',
                });
            })
            .catch((err) => {
                if (cancelled) return;
                setState({ ...describe(err), query: 'done' });
            });

        return () => { cancelled = true; };
    }, [load, enabled, token]);

    // 'forbidden' is its own case: not loading, not an error, not empty
    if (!enabled) return { ...FORBIDDEN, waiting: false, isStale: false };

    return { ...state, waiting: state.query === null, isStale: false };
}

/** Searchable, paged list; options are primitives so the effect sees values, not new objects */
export function useServerList(load, {
    search = '',
    page = 0,
    limit = 0,
    type = '',
    enabled = true,
    token = 0,
    debounceMs = 400,
} = {}) {
    const [state, setState] = useState(INITIAL);

    // Identifies the query; staleness is derived from it, not stored
    const key = `${search}\u0000${page}\u0000${limit}\u0000${type}`;

    useEffect(() => {
        if (!enabled) return undefined;

        let cancelled = false;

        const timer = setTimeout(() => {
            const params = { search };
            if (page) params.page = page;
            if (limit) params.limit = limit;
            if (type) params.type = type;

            load(params)
                .then((answer) => {
                    if (cancelled) return;
                    setState({
                        status: 'ready',
                        data: answer.data || {},
                        error: null,
                        hint: null,
                        query: key,
                    });
                })
                .catch((err) => {
                    if (cancelled) return;
                    setState({ ...describe(err), query: key });
                });
        }, debounceMs);

        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [load, key, search, page, limit, type, enabled, token, debounceMs]);

    if (!enabled) return { ...FORBIDDEN, waiting: false, isStale: false };

    return {
        ...state,
        // No answer yet is loading, not stale
        waiting: state.query === null,
        isStale: state.query !== null && state.query !== key,
    };
}
