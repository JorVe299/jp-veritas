// Zentrale Formatierung. Die Oberflaeche ist englisch, deshalb en-US mit
// Tausenderkomma und ohne Nachkommastellen - Betraege werden gross.

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

/**
 * The API builds jobLabel server-side with German fallbacks ("Kein Job").
 * The label is therefore derived here instead, so nothing leaks through.
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
