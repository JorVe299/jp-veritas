import { useEffect, useState } from 'react';

const INITIAL = {
    status: 'loading', // 'loading' | 'ready' | 'error' | 'unavailable'
    data: null,
    error: null,
    hint: null,
};

/**
 * Laedt einen Teildatensatz eines Citizens (Fahrzeuge, Inventar, Metadaten).
 *
 * Der Sonderfall, der hier eigens auftaucht: HTTP 501 heisst nicht "leer",
 * sondern "diese Tabelle gibt es in diesem Schema nicht". Eine leere Liste
 * zu zeigen waere an der Stelle eine Falschaussage - das Modul meldet sich
 * stattdessen als nicht verfuegbar ab.
 *
 * `loader` muss stabil sein (die Helfer aus api.js sind es), sonst laeuft
 * der Effect bei jedem Rendern erneut.
 */
export function usePlayerResource(loader, citizenid, reloadToken = 0) {
    const [state, setState] = useState(INITIAL);

    useEffect(() => {
        if (!citizenid) return undefined;

        // Gegen Race Conditions: eine aeltere Antwort darf eine neuere nach
        // einem Reload nicht ueberschreiben.
        let cancelled = false;

        loader(citizenid)
            .then((res) => {
                if (cancelled) return;
                setState({ status: 'ready', data: res.data || {}, error: null, hint: null });
            })
            .catch((err) => {
                if (cancelled) return;
                const status = err.response?.status;
                const body = err.response?.data || {};
                setState({
                    status: status === 501 ? 'unavailable' : 'error',
                    data: null,
                    error: body.error || err.message,
                    hint: body.hint || null,
                });
            });

        return () => { cancelled = true; };
    }, [loader, citizenid, reloadToken]);

    return state;
}
