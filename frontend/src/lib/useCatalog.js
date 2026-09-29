import { useEffect, useState } from 'react';
import { fetchMetaItems, fetchMetaVehicles } from '../api';

// Server-side search, debounced: otherwise every keystroke fires a query
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

/** kind: 'items' | 'vehicles'; isStale is derived from the answered query, never stored */
export function useCatalog(kind, search) {
    const [result, setResult] = useState(INITIAL);

    useEffect(() => {
        // A slower, older answer must not overwrite a newer one
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
