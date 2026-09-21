import { useEffect, useState } from 'react';

// Loading for the server area.
//
// The five sections there all read the same way: one GET, and an answer that
// can fail in four different ways that must not be confused with each other.
// usePlayerResource already does this for a citizen's partial records; this
// is the same idea without a citizen in front of it, plus the debounced
// server-side search that useRoster and useCatalog use.
//
// The four ways an answer can go wrong are kept apart deliberately, because
// each one calls for a different sentence on the surface:
//
//   501 'unavailable' - the table does not exist in this schema. An empty
//                       list would be a false statement here.
//   502 'unreachable' - the game server bridge did not answer. The database
//                       is fine; the live side is not.
//   'forbidden'       - not loaded at all, because the role may not.
//   'error'           - everything else, including a network failure with no
//                       answer behind it.

const INITIAL = {
    status: 'loading', // 'loading' | 'ready' | 'error' | 'unavailable' | 'unreachable'
    data: null,
    error: null,
    hint: null,
    query: null, // null = no answer has arrived yet
};

const FORBIDDEN = { ...INITIAL, status: 'forbidden' };

/**
 * Reads an error the way the backend writes them: { error, hint }. err.message
 * is only the last resort - on its own it says "Request failed with status
 * code 502", which explains nothing to anybody.
 */
function describe(err) {
    const code = err?.response?.status;
    const body = err?.response?.data || {};

    return {
        status: code === 501 ? 'unavailable' : code === 502 ? 'unreachable' : 'error',
        data: null,
        // Not every route words its failure the same way: the diagnostics
        // routes put the reason in `message` and the resource routes add a
        // `detail`. Reading only `error` would leave those cases showing
        // "Request failed with status code 502", which tells nobody anything.
        error: body.error || body.message || err?.message || 'The server did not answer.',
        hint: body.hint || body.detail || null,
    };
}

/**
 * One request, no search. `load` has to be stable - the helpers from api.js
 * are, because they are module-level constants.
 *
 * `token` is counted up from outside to load again; the old answer stays on
 * screen until the new one arrives, so a reload does not blank the card.
 */
export function useServerFetch(load, { enabled = true, token = 0 } = {}) {
    const [state, setState] = useState(INITIAL);

    useEffect(() => {
        if (!enabled) return undefined;

        // Against race conditions: a slower older answer must not overwrite
        // a newer one after a reload.
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

    // Without the permission nothing is requested, and then no loading state
    // is true either. Not an error, not "empty" - a case of its own.
    if (!enabled) return { ...FORBIDDEN, waiting: false, isStale: false };

    return { ...state, waiting: state.query === null, isStale: false };
}

/**
 * A searchable, paged list. Every parameter is a primitive so the effect
 * depends on values rather than on an object that is new on every render.
 *
 * The debounce sits inside the effect, exactly as in useCatalog: the cleanup
 * clears the timer, so while typing quickly only the last query is ever sent.
 */
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

    // What this state belongs to. Whether the list on screen is still the
    // answer to the current question is derived from it rather than stored.
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
        // No answer at all yet - that is "loading", not "stale".
        waiting: state.query === null,
        isStale: state.query !== null && state.query !== key,
    };
}
