// Write answers: { message, mode, hint } on success, { error, hint } on failure

/** 'live' | 'offline' | null; null: the answer names no route, so nothing is claimed */
export function modeOf(answer) {
    const mode = answer?.data?.mode;
    if (mode === 'live') return 'live';
    if (mode === 'offline') return 'offline';
    return null;
}

export function modeDetail(mode) {
    if (mode === 'live') return 'Applied live on the server.';
    if (mode === 'offline') return 'The citizen is not connected, so the change went to the database.';
    return '';
}

export function joinDetail(...parts) {
    return parts.filter(Boolean).join(' ') || undefined;
}

/** <StatusNote> failure; server text first: err.message only when nothing answered */
export function failureNote(title, err) {
    const body = err?.response?.data || {};
    const text = body.error || err?.message || 'The server did not answer.';
    return {
        tone: 'error',
        title,
        detail: joinDetail(text, body.hint),
    };
}

export function successNote(answer, fallbackTitle, extra) {
    const body = answer?.data || {};
    return {
        tone: 'success',
        title: body.message || fallbackTitle,
        detail: joinDetail(modeDetail(modeOf(answer)), extra, body.hint),
    };
}
