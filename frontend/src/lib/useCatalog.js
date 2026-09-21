import { useEffect, useState } from 'react';
import { fetchMetaItems, fetchMetaVehicles } from '../api';

// The two catalogs are too large to fetch in one sweep: around 300 items
// and around 900 vehicles. So the filtering happens on the server, debounced
// like the search above the wall - otherwise every keystroke would fire off
// a query of its own.
const DEBOUNCE_MS = 400;
export const CATALOG_LIMIT = 20;

const LOADERS = {
    items: fetchMetaItems,
    vehicles: fetchMetaVehicles,
};

const INITIAL = {
    status: 'loading', // 'loading' | 'ready' | 'error'
    results: [],
    truncated: false,
    matched: 0,
    total: 0,
    error: null,
    query: null, // null = no answer has arrived yet
};

/**
 * Searches one of the reference data catalogs.
 *
 * Like useRoster, the hook keeps data, loading state and the query they
 * belong to together in a single object: "the result is stale" is derived
 * from that instead of being stored alongside it.
 */
export function useCatalog(kind, search) {
    const [result, setResult] = useState(INITIAL);

    useEffect(() => {
        // Guards against race conditions: while typing fast, a slower older
        // answer must not overwrite the newer one.
        let cancelled = false;

        const timer = setTimeout(async () => {
            const load = LOADERS[kind];
            if (!load) return;

            try {
                const res = await load({ search, limit: CATALOG_LIMIT });
                if (cancelled) return;

                const data = res.data || {};
                setResult({
                    status: 'ready',
                    results: Array.isArray(data.results) ? data.results : [],
                    truncated: Boolean(data.truncated),
                    matched: Number(data.matched ?? 0),
                    total: Number(data.total ?? 0),
                    error: null,
                    query: search,
                });
            } catch (err) {
                if (cancelled) return;
                setResult((prev) => ({
                    ...prev,
                    status: 'error',
                    error: err.response?.data?.error || err.message,
                    query: search,
                }));
            }
        }, DEBOUNCE_MS);

        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [kind, search]);

    return { ...result, isStale: result.query !== search };
}
