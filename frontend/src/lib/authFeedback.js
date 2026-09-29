// Sign-in result from the OAuth redirect: ?auth=ok|cancelled|denied|error[&reason=...]
// Read once at module load and stripped from the URL: a reload must not repeat it

const KINDS = new Set(['ok', 'denied', 'cancelled', 'error']);

// Server text shown in the UI: capped so a runaway message cannot break the layout
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

    // Only these two: other query parameters stay
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
        // replaceState can throw (e.g. file://): the URL stays, the message still shows
    }

    const reason = typeof rawReason === 'string' ? rawReason.trim().slice(0, MAX_REASON) : '';

    return {
        // Unknown values become 'error', never passed through
        kind: KINDS.has(kind) ? kind : 'error',
        reason: reason || null,
    };
}

export const authFeedback = takeAuthFeedback();
