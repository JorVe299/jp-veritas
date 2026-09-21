import { useEffect, useMemo, useState } from 'react';
import api from '../api';
import { jobGroup } from '../utils/format';

export const PAGE_SIZE = 24;
const DEBOUNCE_MS = 400;

// A single result object instead of many separate states: that way data,
// loading state and the query they belong to cannot drift apart. "Someone is
// typing right now" is derived from that instead of being stored.
const INITIAL = {
    status: 'loading', // 'loading' | 'ready' | 'error'
    players: [],
    bridge: null,
    error: null,
    query: { search: '', page: 1 },
};

/**
 * `enabled` is the players.view permission. Without it /api/players answers
 * with 403, and the wall would report an error that is none - so it is not
 * loaded in the first place and says instead that the role is not
 * allowed to see it.
 */
export function useRoster(search, page, refreshToken, enabled = true) {
    const [result, setResult] = useState(INITIAL);

    useEffect(() => {
        if (!enabled) return undefined;

        // cancelled guards against race conditions: while typing fast, a
        // slower older answer must not overwrite the newer one.
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

    // Derived, not state: is the wall still showing an old result?
    const isStale = result.query.search !== search || result.query.page !== page;

    // Without the permission nothing is loaded - and then no loading state
    // is true either. 'forbidden' is a case of its own, not an error, not "empty".
    if (!enabled) return { ...INITIAL, status: 'forbidden', isStale: false };

    return { ...result, isStale };
}

/**
 * Splits the returned page into the rails of the wall.
 *
 * Important for how the surface is worded: what gets grouped is exactly what
 * this page delivered - not the database. The headings must therefore never
 * sound as though they were complete.
 */
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

    // Group by employer. Order: largest group first, alphabetical on a tie,
    // so that paging does not jump around.
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

    // Without this threshold a page falls apart into a dozen rails with one
    // entry each - which reads worse than no grouping at all.
    // Everything that stands alone moves to the end together.
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
            // Only one entry left: then its own heading is the honest one.
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
