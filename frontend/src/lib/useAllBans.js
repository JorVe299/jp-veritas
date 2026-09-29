import { useEffect, useState } from 'react';
import { fetchAllBans } from '../api';

// Not useServerList: its param names differ, and which filters reach the server stays visible

const DEBOUNCE_MS = 400;

const INITIAL = {
    status: 'loading', // 'loading' | 'ready' | 'error'
    data: null,
    error: null,
    hint: null,
    query: null, // null = no answer has arrived yet
};

const FORBIDDEN = { ...INITIAL, status: 'forbidden' };

// Backend failures are { error, hint }
function describe(err) {
    const body = err?.response?.data || {};

    return {
        status: 'error',
        data: null,
        // err.message last: "Request failed with status code 500" explains nothing
        error: body.error || body.message || err?.message || 'The server did not answer.',
        hint: body.hint || body.detail || null,
    };
}

/**
 * Both ban records merged, filtered and paged on the server; never filtered client-side
 * An unreadable source is not 'error': a 200 with per-source status; never an empty list
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

    // Identifies the query; staleness is derived from it, not stored
    const key = [search, citizenid, activeOnly, includeWarnings, source, page, limit].join('\u0000');

    useEffect(() => {
        if (!enabled) return undefined;

        // A slower, older answer must never overwrite a newer one
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
        // No answer yet is loading, not stale
        waiting: state.query === null,
        isStale: state.query !== null && state.query !== key,
    };
}
