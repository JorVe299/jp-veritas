import { useEffect, useMemo, useState } from 'react';
import api from '../api';
import { jobGroup } from '../utils/format';

export const PAGE_SIZE = 24;
const DEBOUNCE_MS = 400;

// One object: data, status and their query cannot drift apart; staleness is derived
const INITIAL = {
    status: 'loading', // 'loading' | 'ready' | 'error'
    players: [],
    bridge: null,
    error: null,
    query: { search: '', page: 1 },
};

/** enabled: the players.view permission; /api/players would answer 403 without it */
export function useRoster(search, page, refreshToken, enabled = true) {
    const [result, setResult] = useState(INITIAL);

    useEffect(() => {
        if (!enabled) return undefined;

        // A slower, older answer must not overwrite a newer one
        let cancelled = false;

        const timer = setTimeout(async () => {
            try {
                const res = await api.get('/players', {
                    params: { search, page, limit: PAGE_SIZE },
                });
                if (cancelled) return;

                setResult({
                    status: 'ready',
                    players: res.data.players || [],
                    bridge: res.data.bridge || null,
                    error: null,
                    query: { search, page },
                });
            } catch (err) {
                if (cancelled) return;
                console.error('Roster request failed:', err);
                setResult((prev) => ({
                    ...prev,
                    status: 'error',
                    error: err.response?.data?.error || err.message,
                    query: { search, page },
                }));
            }
        }, DEBOUNCE_MS);

        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [search, page, refreshToken, enabled]);

    const isStale = result.query.search !== search || result.query.page !== page;

    // 'forbidden' is its own case: not loading, not an error, not empty
    if (!enabled) return { ...INITIAL, status: 'forbidden', isStale: false };

    return { ...result, isStale };
}

/** Groups this page only, not the database: rail headings must never sound complete */
export function buildRails(players, bridgeDown) {
    if (!players || players.length === 0) return [];

    const rails = [];
    const rest = [];

    if (!bridgeDown) {
        const online = players.filter((p) => p.isOnline);
        if (online.length > 0) {
            rails.push({ id: 'online', title: 'On the server now', tone: 'live', players: online });
        }
        players.forEach((p) => { if (!p.isOnline) rest.push(p); });
    } else {
        rest.push(...players);
    }

    // Largest first, then alphabetical: a stable order while paging
    const byJob = new Map();
    rest.forEach((p) => {
        const key = jobGroup(p);
        if (!byJob.has(key)) byJob.set(key, []);
        byJob.get(key).push(p);
    });

    const groups = [...byJob.entries()].sort((a, b) => {
        if (b[1].length !== a[1].length) return b[1].length - a[1].length;
        return a[0].localeCompare(b[0]);
    });

    // Singletons share one final rail: a dozen one-entry rails read worse than none
    const MIN_RAIL = 2;
    const singles = [];

    groups.forEach(([title, group]) => {
        if (group.length >= MIN_RAIL) {
            rails.push({ id: `job-${title}`, title, tone: 'plain', players: group });
        } else {
            singles.push(...group);
        }
    });

    if (singles.length > 0) {
        rails.push({
            id: 'other',
            // A lone entry keeps its own heading
            title: singles.length === 1 ? jobGroup(singles[0]) : 'Other roles',
            tone: 'plain',
            players: singles,
        });
    }

    return rails;
}

export function useRails(players, bridgeDown) {
    return useMemo(() => buildRails(players, bridgeDown), [players, bridgeDown]);
}
