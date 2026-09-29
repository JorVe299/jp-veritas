// en-US to match the English UI; no decimals: amounts get large

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

export function formatMoney(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return moneyFormatter.format(n);
}

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
    return `${formatted.slice(0, 1)}$${formatted.slice(1)}`;
}

// 3 significant digits: "$1.23B" fits the tightest box and still says which billion
const compactFormatter = new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumSignificantDigits: 3,
});

// Compact stops at T and then grows unbounded ("1,230,000T"); scientific stays short
const scientificFormatter = new Intl.NumberFormat('en-US', {
    notation: 'scientific',
    maximumSignificantDigits: 3,
});

// 999.5T and up would round to "1000T" in compact notation
const COMPACT_CEILING = 9.995e14;

/**
 * 1234567 -> "1.23M"; only where a box is too narrow for the full figure (see <Amount>)
 * Never for a value acted on; never alone: exact figure also in title and screen-reader text
 */
export function formatCompact(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return Math.abs(n) >= COMPACT_CEILING ? scientificFormatter.format(n) : compactFormatter.format(n);
}

export function formatCurrencyCompact(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return `$${formatCompact(n)}`;
}

/** "02:14" (24-hour) */
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

// ISO text, Unix seconds (ban expiry) or ms; seconds stay below 1e11 until the year 5138
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

/** "Mar 04, 2026, 21:40"; missing or unreadable -> "—" */
export function formatDateTime(value) {
    const date = toDate(value);
    return date ? dateTimeFormatter.format(date) : '—';
}

/** One decimal: nobody aims finer in game */
export function formatCoord(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n.toFixed(1) : '—';
}

/**
 * "Employer · Grade" or "Unemployed"
 * Not the API's jobLabel: the grade is needed, and unemployed must read the same everywhere
 */
export function jobTitle(player) {
    const job = player?.job;
    if (!job || !job.name) return 'Unemployed';
    const label = job.label || job.name;
    const grade = job.grade?.name;
    return grade ? `${label} · ${grade}` : label;
}

/** jobTitle without the grade: the rail key */
export function jobGroup(player) {
    const job = player?.job;
    if (!job || !job.name) return 'Unemployed';
    return job.label || job.name;
}

export function initials(name) {
    if (!name) return '??';
    const parts = String(name).trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '??';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function parseAmount(raw) {
    if (typeof raw !== 'string') return Number.NaN;
    const cleaned = raw.trim().replace(/,/g, '');
    if (cleaned === '') return Number.NaN;
    return Number(cleaned);
}
