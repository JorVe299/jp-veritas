import { formatCompact, formatCurrency, formatCurrencyCompact, formatMoney } from '../utils/format';

/**
 * A measured figure that has to fit a box it does not control - a balance
 * card, a tile, a slot. Two things happen here, and neither ever cuts a
 * digit off: a clipped number reads as a different, wrong number.
 *
 * - From `compactFrom` upwards the figure is shortened ("$1.23B"). The exact
 *   one stays in the title and is what a screen reader hears. Leave
 *   `compactFrom` out and the figure is always exact.
 * - The character count goes out as --fit-chars, so a box using .u-fit can
 *   shrink the type until the whole figure fits. Mono digits all share one
 *   advance, which makes the count as good as a measurement.
 *
 * `currency={false}` is for plain counts; below the threshold those keep
 * exactly the form they had before (no separators), so an ordinary count
 * looks as it always did.
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
