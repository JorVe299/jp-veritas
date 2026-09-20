import { useEffect, useState } from 'react';
import { fetchMetaItems, fetchMetaVehicles } from '../api';

// Die beiden Kataloge sind zu gross fuer einen Rundumschlag: rund 300 Items
// und rund 900 Fahrzeuge. Gefiltert wird deshalb serverseitig, und zwar
// entprellt wie die Suche ueber der Wand - sonst schickt jeder Tastendruck
// eine eigene Abfrage los.
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
    query: null, // null = es liegt noch keine Antwort vor
};

/**
 * Sucht in einem der Stammdatenkataloge.
 *
 * Wie useRoster haelt der Hook Daten, Ladezustand und die Abfrage, zu der sie
 * gehoeren, in einem einzigen Objekt zusammen: "das Ergebnis ist veraltet"
 * wird daraus abgeleitet und nicht nebenher gespeichert.
 */
export function useCatalog(kind, search) {
    const [result, setResult] = useState(INITIAL);

    useEffect(() => {
        // Schuetzt vor Race Conditions: beim schnellen Tippen darf eine
        // langsamere aeltere Antwort die neuere nicht ueberschreiben.
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
