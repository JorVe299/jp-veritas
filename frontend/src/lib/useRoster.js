import { useEffect, useMemo, useState } from 'react';
import api from '../api';
import { jobGroup } from '../utils/format';

export const PAGE_SIZE = 24;
const DEBOUNCE_MS = 400;

// Ein einziges Ergebnis-Objekt statt vieler Einzel-States: dadurch koennen
// Daten, Ladezustand und die Abfrage, zu der sie gehoeren, nicht auseinander
// laufen. "Wird gerade getippt" leiten wir daraus ab, statt es zu speichern.
const INITIAL = {
    status: 'loading', // 'loading' | 'ready' | 'error'
    players: [],
    bridge: null,
    error: null,
    query: { search: '', page: 1 },
};

export function useRoster(search, page, refreshToken) {
    const [result, setResult] = useState(INITIAL);

    useEffect(() => {
        // cancelled schuetzt vor Race Conditions: bei schnellem Tippen darf
        // eine langsamere aeltere Antwort die neuere nicht ueberschreiben.
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
    }, [search, page, refreshToken]);

    // Abgeleitet, kein State: zeigt die Wand gerade noch ein altes Ergebnis?
    const isStale = result.query.search !== search || result.query.page !== page;

    return { ...result, isStale };
}

/**
 * Teilt die zurueckgegebene Seite in die Schienen der Wand.
 *
 * Wichtig fuer die Formulierung in der Oberflaeche: gruppiert wird genau
 * das, was diese Seite geliefert hat - nicht die Datenbank. Die Rubriken
 * duerfen deshalb nie so klingen, als waeren sie vollstaendig.
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

    // Nach Arbeitgeber gruppieren. Reihenfolge: groesste Gruppe zuerst,
    // bei Gleichstand alphabetisch, damit das Blaettern nicht springt.
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

    // Ohne diese Schwelle zerfaellt eine Seite in ein Dutzend Schienen mit je
    // einem Eintrag - das liest sich schlechter als gar keine Gruppierung.
    // Alles Einzelne wandert zusammen ans Ende.
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
            // Nur ein Eintrag uebrig: dann ist seine eigene Rubrik ehrlicher.
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
