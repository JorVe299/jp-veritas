import { formatCompact, formatCurrency, formatCurrencyCompact, formatMoney } from '../utils/format';

/**
 * Figure that must fit a box it does not control; never clipped: a cut number reads as another
 * Shortened from compactFrom up ("$1.23B"); exact value in the title and for screen readers
 * --fit-chars lets a .u-fit box shrink the type; mono digits make the char count a width
 */
export default function Amount({ value, currency = true, compactFrom = Infinity, className }) {
    const n = Number(value);
    const known = value !== null && value !== undefined && value !== '' && Number.isFinite(n);
    const compacted = known && Math.abs(n) >= compactFrom;

    const exact = currency ? formatCurrency(value) : (known ? formatMoney(n) : String(value ?? '—'));
    const shown = compacted
        ? (currency ? formatCurrencyCompact(n) : formatCompact(n))
        : (currency ? exact : String(value ?? '—'));

    return (
        <span
            className={className || undefined}
            style={{ '--fit-chars': shown.length }}
            title={compacted ? exact : undefined}
        >
            {compacted ? (
                <>
                    <span aria-hidden="true">{shown}</span>
                    <span className="u-sr">{exact}</span>
                </>
            ) : shown}
        </span>
    );
}
