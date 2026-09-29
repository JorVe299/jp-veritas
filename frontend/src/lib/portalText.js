// Shared by front door and character view: one answer to "what is this character called"

/** Stands for a missing value; nothing is invented in its place */
export const DASH = '—';

function text(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed || null;
}

export function shown(value) {
    return text(value) ?? DASH;
}

/**
 * List `name`, else detail `charinfo` parts, else the citizen id
 * The id is never pretty but always true: better than "Unknown"
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

/** Grade as number, name or framework object; any other shape -> null, never guessed */
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

export function jobLine(job) {
    if (!job || typeof job !== 'object') return 'Unemployed';

    const name = text(job.label) || text(job.name);
    if (!name) return 'Unemployed';

    const grade = gradeText(job.grade);
    return grade ? `${name} · ${grade}` : name;
}

/** As jobLine for a gang; null when none, the normal case */
export function gangLine(gang) {
    if (!gang || typeof gang !== 'object') return null;

    const name = text(gang.label) || text(gang.name);
    if (!name || name.toLowerCase() === 'none') return null;

    const grade = gradeText(gang.grade);
    return grade ? `${name} · ${grade}` : name;
}

/** A missing number stays null, never 0 */
export function numberOrNull(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}
