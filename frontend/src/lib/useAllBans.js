import { useEffect, useState } from 'react';
import { fetchAllBans } from '../api';

// Loading for the one merged ban list.
//
// This replaces the two loaders that stood here before - one for the
// database table, one for txAdmin's file. There is one route now and one
// hook, because the surface asks one question: who is kept out, in either
// record.
//
// Deliberately not useServerList. That hook speaks the parameter names of
// the older database routes (search, page, type) and this route speaks the
// merged one's: q, citizenid, active, include, source, page, limit.
// Translating one set into the other would save a file and cost the next
// reader the answer to "which of these filters actually reached the
// server", which is the question a merged list has to keep answerable.
//
// Three states, because the route has three outcomes:
//
//   'loading' - the request is running
//   'ready'   - the route answered
//   'error'   - it did not, or refused
//
// A source that could not be read is expressly NOT one of them. The route
// answers that with 200 and says so per source in the body, because it is
// not a failed request - it is a successful answer that is missing half
// its material. Only the surface can decide how to draw that, and it must
// never draw it as an empty list.

const DEBOUNCE_MS = 400;

const INITIAL = {
    status: 'loading', // 'loading' | 'ready' | 'error'
    data: null,
    error: null,
    hint: null,
    query: null, // null = no answer has arrived yet
};

const FORBIDDEN = { ...INITIAL, status: 'forbidden' };

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
 * Both ban records, merged, filtered and paged on the server.
 *
 * Nothing is filtered here. The two records together can run to thousands
 * of rows, and a client-side filter over one page of them would answer a
 * different question than the one asked - it would search what happened to
 * arrive rather than what is on record.
 *
 * The debounce sits inside the effect, as in useServerList and useCatalog:
 * the cleanup clears the timer, so while typing quickly only the last
 * query is ever sent.
 */
export function useAllBans({
    search = '',
    citizenid = '',
    activeOnly = false,
    includeWarnings = false,
    source = '',
    page = 1,
    limit = 0,
    enabled = true,
    token = 0,
} = {}) {
    const [state, setState] = useState(INITIAL);

    // What the state on screen belongs to. Whether it still answers the
    // current question is derived from this rather than stored.
    const key = [search, citizenid, activeOnly, includeWarnings, source, page, limit].join('\u0000');

    useEffect(() => {
        if (!enabled) return undefined;

        // Against race conditions: a slower older answer must never
        // overwrite a newer one.
        let cancelled = false;

        const timer = setTimeout(() => {
            const params = {};
            if (search) params.q = search;
            if (citizenid) params.citizenid = citizenid;
            if (activeOnly) params.active = 'true';
            if (includeWarnings) params.include = 'warnings';
            if (source) params.source = source;
            if (page > 1) params.page = page;
            if (limit) params.limit = limit;

            fetchAllBans(params)
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
    }, [key, search, citizenid, activeOnly, includeWarnings, source, page, limit, enabled, token]);

    if (!enabled) return { ...FORBIDDEN, waiting: false, isStale: false };

    return {
        ...state,
        // No answer at all yet - that is "loading", not "stale".
        waiting: state.query === null,
        isStale: state.query !== null && state.query !== key,
    };
}
