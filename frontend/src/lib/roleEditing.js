// Mirror of backend/utils/roleStore.js for inline errors; the server still decides
// The server silently drops non-snowflake Discord ids: a pasted name must be flagged here

/** Must match cleanLabel() in the store */
export const MAX_LABEL = 48;

/** Per-list cap of cleanIdList() in the store */
export const MAX_IDS = 200;

// Stored in sessions and a JSON file: kept plain
const ID_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/;

const SNOWFLAKE = /^\d{5,25}$/;

export function idFromLabel(label) {
    const slug = String(label || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 32);
    return /^[a-z]/.test(slug) ? slug : `role-${slug}`.slice(0, 32);
}

export function cleanLabel(value) {
    return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, MAX_LABEL);
}

export const validRoleId = (id) => ID_PATTERN.test(String(id || ''));

export const isSnowflake = (value) => SNOWFLAKE.test(String(value || '').trim());

/** Error sentence or null; empty is valid: the server derives the id from the label */
export function roleIdProblem(value) {
    const id = String(value || '').trim();
    if (!id) return null;
    if (id !== id.toLowerCase()) return 'An id is lowercase — capitals are not allowed in it.';
    if (!/^[a-z]/.test(id)) return 'An id has to start with a letter.';
    if (id.length > 32) return 'An id is at most 32 characters long.';
    if (!validRoleId(id)) return 'An id may hold only letters, digits, hyphens and underscores.';
    return null;
}

/** Error sentence or null; names Copy ID: the usual mistake is pasting a name */
export function snowflakeProblem(value) {
    const id = String(value || '').trim();
    if (!id) return 'Paste a Discord id first.';

    if (!/^\d+$/.test(id)) {
        return 'Digits only. In Discord: Developer Mode on, then right-click › Copy ID.';
    }
    if (id.length < 5) return `A Discord id is at least 5 digits; this one has ${id.length}.`;
    if (id.length > 25) return `A Discord id is at most 25 digits; this one has ${id.length}.`;
    // Checks above only pick the message; SNOWFLAKE is the store's rule (a backend test checks)
    return isSnowflake(id) ? null : 'That is not a Discord id.';
}

/** Order-insensitive */
export function sameIds(a, b) {
    const left = Array.isArray(a) ? [...a].sort() : [];
    const right = Array.isArray(b) ? [...b].sort() : [];
    if (left.length !== right.length) return false;
    return left.every((id, i) => id === right[i]);
}
