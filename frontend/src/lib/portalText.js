// Small readings of the portal's payloads, shared by the front door and the
// character view. Pure functions, no React: two surfaces must not each make
// up their own answer to "what is this character called".

/** Nothing is invented here: a missing value stays missing, and reads as one. */
export const DASH = '—';

function text(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed || null;
}

/** A value as it should appear in a field, or the em dash for "not recorded". */
export function shown(value) {
    return text(value) ?? DASH;
}

/**
 * What to call a character.
 *
 * The list sends `name`, the detail sends the parts inside `charinfo`, and
 * either can be missing. The citizen id is the last resort: it is never
 * pretty but it is always true, and it beats the word "Unknown" standing
 * where a person's name belongs.
 */
export function characterName(source) {
    if (!source || typeof source !== 'object') return DASH;

    const whole = text(source.name);
    if (whole) return whole;

    const info = source.charinfo && typeof source.charinfo === 'object' ? source.charinfo : source;
    const first = text(info.firstname);
    const last = text(info.lastname);
    if (first || last) return [first, last].filter(Boolean).join(' ');

    return text(source.citizenid) ?? DASH;
}

/**
 * A grade can arrive as a number, as a name, or as the object the framework
 * keeps it in. All three are read; nothing is guessed from a shape that is
 * none of them.
 */
export function gradeText(grade) {
    if (grade === null || grade === undefined) return null;
    if (typeof grade === 'number' || typeof grade === 'string') return text(grade);

    if (typeof grade === 'object') {
        const name = text(grade.name) || text(grade.label);
        const level = text(grade.level) ?? text(grade.grade);
        if (name && level) return `${name} · ${level}`;
        return name || level;
    }

    return null;
}

/** "Police · Sergeant", or "Unemployed" when there is no job at all. */
export function jobLine(job) {
    if (!job || typeof job !== 'object') return 'Unemployed';

    const name = text(job.label) || text(job.name);
    if (!name) return 'Unemployed';

    const grade = gradeText(job.grade);
    return grade ? `${name} · ${grade}` : name;
}

/** The same for a gang. A character without one is the normal case. */
export function gangLine(gang) {
    if (!gang || typeof gang !== 'object') return null;

    const name = text(gang.label) || text(gang.name);
    if (!name || name.toLowerCase() === 'none') return null;

    const grade = gradeText(gang.grade);
    return grade ? `${name} · ${grade}` : name;
}

/** A number from the server, or null - never a zero standing in for one. */
export function numberOrNull(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}
