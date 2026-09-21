// Central formatting. The surface is English, hence en-US with thousands
// separators and no decimals - amounts get large.

const moneyFormatter = new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 0,
});

const signedFormatter = new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 0,
    signDisplay: 'always',
});

const timeFormatter = new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
});

/** 12000 -> "12,000". Invalid values become an em dash. */
export function formatMoney(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return moneyFormatter.format(n);
}

/** 12000 -> "$12,000" */
export function formatCurrency(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return `$${moneyFormatter.format(n)}`;
}

/** -500 -> "−$500", 500 -> "+$500" */
export function formatDelta(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    const formatted = signedFormatter.format(n);
    // Sign and amount are split so the $ sits tight against the digits.
    return `${formatted.slice(0, 1)}$${formatted.slice(1)}`;
}

/** 02:14 - used on the write records so each one is placeable in time. */
export function formatTime(date = new Date()) {
    return timeFormatter.format(date);
}

const dateTimeFormatter = new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
});

/**
 * Timestamps from the database come in three shapes: as ISO text, as Unix
 * seconds (that is how a ban stores its expire) and as milliseconds.
 * Seconds and milliseconds are both numbers - they are told apart by order
 * of magnitude, because second values do not reach that threshold until
 * the year 5138.
 */
function toDate(value) {
    if (value === null || value === undefined || value === '') return null;

    if (typeof value === 'number' || /^\d+$/.test(String(value))) {
        const n = Number(value);
        if (!Number.isFinite(n) || n <= 0) return null;
        const date = new Date(n < 1e11 ? n * 1000 : n);
        return Number.isNaN(date.getTime()) ? null : date;
    }

    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

/** "Mar 04, 2026, 21:40". Unreadable or missing values become an em dash. */
export function formatDateTime(value) {
    const date = toDate(value);
    return date ? dateTimeFormatter.format(date) : '—';
}

/** true when the timestamp lies in the past. */
export function isPast(value) {
    const date = toDate(value);
    return date ? date.getTime() < Date.now() : false;
}

/** World coordinates to one decimal - nobody aims finer than that in game. */
export function formatCoord(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n.toFixed(1) : '—';
}

/**
 * Derived here rather than taken from the API's jobLabel: the wall needs
 * the grade alongside the employer, and an unemployed character has to
 * read the same way everywhere it appears.
 */
export function jobTitle(player) {
    const job = player?.job;
    if (!job || !job.name) return 'Unemployed';
    const label = job.label || job.name;
    const grade = job.grade?.name;
    return grade ? `${label} · ${grade}` : label;
}

/** Just the employer, for grouping the wall into rails. */
export function jobGroup(player) {
    const job = player?.job;
    if (!job || !job.name) return 'Unemployed';
    return job.label || job.name;
}

/** "Jordan Michael" -> "JM". Used when a plate needs a monogram. */
export function initials(name) {
    if (!name) return '??';
    const parts = String(name).trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '??';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Reads user input like "1,500" or "1500.50" as a number. */
export function parseAmount(raw) {
    if (typeof raw !== 'string') return Number.NaN;
    const cleaned = raw.trim().replace(/,/g, '');
    if (cleaned === '') return Number.NaN;
    return Number(cleaned);
}
