// Rueckmeldung des Anmeldeversuchs.
//
// Das Backend leitet nach dem Discord-Dialog auf "/" zurueck und haengt das
// Ergebnis als Query-Parameter an: ?auth=ok, ?auth=cancelled,
// ?auth=denied&reason=..., ?auth=error&reason=...
//
// Einmal beim Laden des Moduls gelesen und sofort aus der Adresszeile
// entfernt: bliebe der Parameter stehen, wiederholte jeder Reload dieselbe
// Meldung - auch dann noch, wenn sie laengst nicht mehr stimmt.

const KINDS = new Set(['ok', 'denied', 'cancelled', 'error']);

// Der reason-Text kommt vom Server und wird angezeigt. Laenge begrenzen,
// damit eine ausufernde Fehlermeldung das Layout nicht sprengt.
const MAX_REASON = 300;

function takeAuthFeedback() {
    if (typeof window === 'undefined') return null;

    let params;
    try {
        params = new URLSearchParams(window.location.search);
    } catch {
        return null;
    }

    const kind = params.get('auth');
    if (!kind) return null;

    const rawReason = params.get('reason');

    // Nur die beiden eigenen Parameter entfernen, alles andere in der URL
    // gehoert jemand anderem und bleibt stehen.
    params.delete('auth');
    params.delete('reason');

    try {
        const query = params.toString();
        window.history.replaceState(
            window.history.state,
            '',
            `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`,
        );
    } catch {
        // replaceState kann in Sonderfaellen fehlschlagen (z.B. file://).
        // Dann bleibt die URL stehen - die Meldung stimmt trotzdem.
    }

    const reason = typeof rawReason === 'string' ? rawReason.trim().slice(0, MAX_REASON) : '';

    return {
        // Unbekannte Werte nicht durchreichen, sondern als technischen
        // Fehler behandeln - erfunden hat sie niemand.
        kind: KINDS.has(kind) ? kind : 'error',
        reason: reason || null,
    };
}

export const authFeedback = takeAuthFeedback();
