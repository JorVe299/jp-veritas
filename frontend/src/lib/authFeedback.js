// Feedback from the sign-in attempt.
//
// After the Discord dialog the backend redirects back to "/" and appends the
// result as query parameters: ?auth=ok, ?auth=cancelled,
// ?auth=denied&reason=..., ?auth=error&reason=...
//
// Read once when the module loads and taken out of the address bar right
// away: if the parameter stayed, every reload would repeat the same
// message - long after it stopped being true.

const KINDS = new Set(['ok', 'denied', 'cancelled', 'error']);

// The reason text comes from the server and gets displayed. Cap the length
// so a runaway error message cannot blow up the layout.
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

    // Remove only our own two parameters; everything else in the URL
    // belongs to someone else and stays.
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
        // replaceState can fail in edge cases (e.g. file://).
        // The URL then stays as it is - the message still holds.
    }

    const reason = typeof rawReason === 'string' ? rawReason.trim().slice(0, MAX_REASON) : '';

    return {
        // Do not pass unknown values through; treat them as a technical
        // error - nobody made them up.
        kind: KINDS.has(kind) ? kind : 'error',
        reason: reason || null,
    };
}

export const authFeedback = takeAuthFeedback();
