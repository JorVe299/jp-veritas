// Feedback from a write.
//
// The four new modules (bans, groups, accounts, live actions) all answer the
// same three questions: did it go through? By which route? And if not, what
// does the server say about it. The backend's answers are built the same way
// throughout ({ error, hint } on failure, { message, mode, hint } on
// success), so reading them out lives here once instead of being repeated in
// every module.

/**
 * 'live' | 'offline' | null. null means: this route says nothing about the
 * route - and then nothing is claimed.
 */
export function modeOf(answer) {
    const mode = answer?.data?.mode;
    if (mode === 'live') return 'live';
    if (mode === 'offline') return 'offline';
    return null;
}

/** The sentence that explains the route. Without a mode it stays empty. */
export function modeDetail(mode) {
    if (mode === 'live') return 'Applied live on the server.';
    if (mode === 'offline') return 'The citizen is not connected, so the change went to the database.';
    return '';
}

/** Several sentences into one detail line; empty parts fall away. */
export function joinDetail(...parts) {
    return parts.filter(Boolean).join(' ') || undefined;
}

/**
 * Failure note for <StatusNote>. The text comes from the server's answer,
 * not from err.message - the latter would be "Request failed with status
 * code 409" and therefore useless. Many answers also carry a hint that
 * names the actual reason; it belongs in the detail line.
 *
 * Only when there is no answer at all (network error, server not
 * reachable) does err.message remain as the only information available.
 */
export function failureNote(title, err) {
    const body = err?.response?.data || {};
    const text = body.error || err?.message || 'The server did not answer.';
    return {
        tone: 'error',
        title,
        detail: joinDetail(text, body.hint),
    };
}

/**
 * Success note. The server phrases the heading itself when it sends a
 * message; the fallback is the module's own sentence.
 */
export function successNote(answer, fallbackTitle, extra) {
    const body = answer?.data || {};
    return {
        tone: 'success',
        title: body.message || fallbackTitle,
        detail: joinDetail(modeDetail(modeOf(answer)), extra, body.hint),
    };
}
