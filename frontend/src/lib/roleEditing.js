// The rules a role has to obey, written down on this side as well.
//
// Not a second opinion: backend/utils/roleStore.js decides, and it decides
// again on every request. What stands here only lets the field say what is
// wrong while it is being typed, instead of letting the server answer with
// a 400 - or worse, accept the write and silently drop the value.
//
// That last case is the reason this file exists at all. The server cleans
// the Discord lists rather than refusing them: anything that is not a
// snowflake is thrown away without a word. Somebody who pastes a username
// would watch it vanish and have no idea why. So the field says so first.

/** Same ceiling as cleanLabel() in the store. */
export const MAX_LABEL = 48;

/** cleanIdList() keeps at most this many ids per list. */
export const MAX_IDS = 200;

// A role id ends up in a session and in a JSON file, so it stays boring.
const ID_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/;

// A Discord snowflake: digits, and between five and twenty-five of them.
const SNOWFLAKE = /^\d{5,25}$/;

/** The id the server would derive from a label, so the field can show it. */
export function idFromLabel(label) {
    const slug = String(label || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 32);
    return /^[a-z]/.test(slug) ? slug : `role-${slug}`.slice(0, 32);
}

/** Whitespace collapsed and cut to length, exactly as the store does it. */
export function cleanLabel(value) {
    return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, MAX_LABEL);
}

export const validRoleId = (id) => ID_PATTERN.test(String(id || ''));

export const isSnowflake = (value) => SNOWFLAKE.test(String(value || '').trim());

/**
 * What is wrong with a typed id, as a sentence - or null when nothing is.
 * Only for the optional id field: leaving it empty is fine, the server
 * derives one from the label.
 */
export function roleIdProblem(value) {
    const id = String(value || '').trim();
    if (!id) return null;
    if (id !== id.toLowerCase()) return 'An id is lowercase — capitals are not allowed in it.';
    if (!/^[a-z]/.test(id)) return 'An id has to start with a letter.';
    if (id.length > 32) return 'An id is at most 32 characters long.';
    if (!validRoleId(id)) return 'An id may hold only letters, digits, hyphens and underscores.';
    return null;
}

/**
 * What is wrong with a pasted Discord id. The sentence names the way to get
 * the right one, because the usual mistake is pasting a name.
 */
export function snowflakeProblem(value) {
    const id = String(value || '').trim();
    if (!id) return 'Paste a Discord id first.';

    if (!/^\d+$/.test(id)) {
        return 'A Discord id is digits only — this is a name, not an id. '
            + 'In Discord turn on Developer Mode under Advanced, then right-click '
            + 'the account or the role and choose Copy ID.';
    }
    if (id.length < 5) return `A Discord id is at least 5 digits; this one has ${id.length}.`;
    if (id.length > 25) return `A Discord id is at most 25 digits; this one has ${id.length}.`;
    return null;
}

/** Two id lists, order disregarded. */
export function sameIds(a, b) {
    const left = Array.isArray(a) ? [...a].sort() : [];
    const right = Array.isArray(b) ? [...b].sort() : [];
    if (left.length !== right.length) return false;
    return left.every((id, i) => id === right[i]);
}

/** Only what the server would keep, so the field shows what it will get. */
export const idList = (value) => (Array.isArray(value) ? value.filter(isSnowflake) : []);
