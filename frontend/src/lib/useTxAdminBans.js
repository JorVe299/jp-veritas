import { useEffect, useState } from 'react';
import { fetchTxAdminBans } from '../api';

// Loading for txAdmin's ban record.
//
// Deliberately not useServerList. That hook speaks the parameter names of
// the database routes - search, page, type - and this route speaks
// txAdmin's own: q, active, include, limit. Bending one set into the other
// would have saved a file and cost the next reader the answer to "which of
// the two lists am I looking at", which is the one question this whole area
// has to keep answerable.
//
// The states it reports are the ones the server area already reads:
//
//   'loading' - the request is running
//   'ready'   - the route answered
//   'error'   - it did not, or refused
//
// "The record could not be read" is expressly NOT one of them. The route
// answers that with 200 and an `available: false` body, because it is not a
// failed request - it is a successful answer that says nobody could look.
// The hook passes it through untouched; only the surface can decide how to
// draw it, and it must never draw it as an empty list.

const DEBOUNCE_MS = 400;

const INITIAL = {
    status: 'loading', // 'loading' | 'ready' | 'error'
    data: null,
    error: null,
    hint: null,
    query: null, // null = no answer has arrived yet
};

/** Reads a failure the way the backend writes them: { error, hint }. */
function describe(err) {
    const body = err?.response?.data || {};

    return {
        status: 'error',
        data: null,
        // err.message alone says "Request failed with status code 500",
        // which explains nothing to the person reading the panel.
        error: body.error || body.message || err?.message || 'The server did not answer.',
        hint: body.hint || body.detail || null,
    };
}

/**
 * The txAdmin record, searched and filtered on the server.
 *
 * The store can hold thousands of rows, so nothing is filtered here: the
 * query, the in-force filter and the limit all travel with the request, and
 * the answer says how much of the match came back.
 *
 * The debounce sits inside the effect, as in useServerList and useCatalog -
 * the cleanup clears the timer, so while typing quickly only the last query
 * is ever sent.
 */
export function useTxAdminBans({
    search = '',
    activeOnly = false,
    includeWarnings = false,
    limit = 0,
    enabled = true,
    token = 0,
} = {}) {
    const [state, setState] = useState(INITIAL);

    // What the state on screen belongs to. Whether it still answers the
    // current question is derived from this rather than stored.
    const key = `${search}\u0000${activeOnly}\u0000${includeWarnings}\u0000${limit}`;

    useEffect(() => {
        if (!enabled) return undefined;

        // Against race conditions: a slower older answer must never
        // overwrite a newer one.
        let cancelled = false;

        const timer = setTimeout(() => {
            const params = {};
            if (search) params.q = search;
            if (activeOnly) params.active = 'true';
            if (includeWarnings) params.include = 'warnings';
            if (limit) params.limit = limit;

            fetchTxAdminBans(params)
                .then((answer) => {
                    if (cancelled) return;
                    setState({
                        status: 'ready',
                        data: answer.data && typeof answer.data === 'object' ? answer.data : {},
                        error: null,
                        hint: null,
                        query: key,
                    });
                })
                .catch((err) => {
                    if (cancelled) return;
                    setState({ ...describe(err), query: key });
                });
        }, DEBOUNCE_MS);

        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [key, search, activeOnly, includeWarnings, limit, enabled, token]);

    if (!enabled) {
        return { ...INITIAL, status: 'forbidden', waiting: false, isStale: false };
    }

    return {
        ...state,
        // No answer at all yet - that is "loading", not "stale".
        waiting: state.query === null,
        isStale: state.query !== null && state.query !== key,
    };
}
