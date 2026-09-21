import { DASH } from '../lib/portalText';
import { formatDateTime } from '../utils/format';

/**
 * One entry out of txAdmin's record.
 *
 * The row that matters most by what it does not have: no lift, no edit, no
 * delete, and nothing that could be mistaken for one. txAdmin owns that
 * file and this panel only reads it, so a control here would be an offer
 * nobody can keep - and an admin who pressed it and found nothing would
 * have learned the wrong thing about who holds this ban.
 *
 * How the entry stands is read from the server's flags and never worked
 * out again here. The order of the branches is the order the flags rank in:
 * a lifted ban is not in force however permanent it was, and an expiry that
 * has passed is not a block.
 */
export default function TxAdminBanLine({ entry }) {
    const warning = entry?.type === 'warn';
    const state = stateOf(entry, warning);
    const identifiers = groupIdentifiers(entry?.identifiers);
    const identifierCount = identifiers.reduce((sum, group) => sum + group.values.length, 0);

    const reason = text(entry?.reason);
    const playerName = text(entry?.playerName);
    const author = text(entry?.author);
    const reference = text(entry?.id);
    const issued = when(entry?.issuedAt);

    // Everything under the reason in reading order: who it is against, who
    // issued it, when it began, how it ends, what to quote in txAdmin when
    // asking about it. Missing parts are left out rather than filled with a
    // dash - a row is not improved by four em dashes in a line.
    const facts = [
        playerName ? { key: 'who', text: `Against ${playerName}` } : null,
        author ? { key: 'author', text: `By ${author}` } : null,
        { key: 'issued', text: issued ? `Issued ${issued}` : 'Issue date not recorded' },
        state.term ? { key: 'term', text: state.term } : null,
        reference ? { key: 'id', label: 'Reference', text: reference, mono: true } : null,
    ].filter(Boolean);

    return (
        <li className={`line${state.spent ? ' line--spent' : ''}`}>
            <div className="line__top">
                <span className="line__name">{reason || 'No reason recorded'}</span>
                <span className={`pill ${state.pill} line__badge`}>{state.badge}</span>
            </div>

            <div className="line__meta">
                {facts.map((fact) => (
                    <span key={fact.key}>
                        {fact.label ? `${fact.label} ` : null}
                        <span className={fact.mono ? 'u-mono' : undefined}>{fact.text}</span>
                    </span>
                ))}
            </div>

            {/* The identifiers are what staff cross-reference by, and a bare
                run of hex strings across the row is noise on every row that
                is not being cross-referenced. Folded away, grouped by the
                kind of identifier, and counted in the summary so it is
                worth opening only when it is. */}
            {identifierCount > 0 && (
                <details className="reveal line__ids">
                    <summary className="reveal__summary">
                        {`${identifierCount} identifier${identifierCount === 1 ? '' : 's'} · ${identifiers.map((group) => group.kind).join(', ')}`}
                    </summary>
                    <div className="reveal__body">
                        {identifiers.map((group) => (
                            <p className="line__idgroup" key={group.kind}>
                                <span className="line__idkind u-caps">{group.kind}</span>
                                {group.values.map((value, index) => (
                                    <span className="u-mono" key={`${group.kind}-${index}`}>{value}</span>
                                ))}
                            </p>
                        ))}
                    </div>
                </details>
            )}
        </li>
    );
}

/** A trimmed string, or null - every one of these fields can arrive empty. */
function text(value) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed || null;
}

/** A timestamp, or null where there is none - never a sentence trailing into a dash. */
function when(value) {
    const shown = formatDateTime(value);
    return shown === DASH ? null : shown;
}

/** Whether this entry is in force. Read from the server's field, not recomputed. */
function inForce(entry) {
    return entry?.active === true;
}

function stateOf(entry, warning) {
    // A warning blocks nobody, so "in force" and "expired" are the wrong
    // words for it entirely. It is named for what it is and left at that.
    if (warning) {
        return { badge: 'Warning', pill: 'pill--off', spent: true, term: null };
    }

    if (inForce(entry)) {
        const until = when(entry?.expiresAt);
        return {
            badge: entry?.permanent === true ? 'In force · permanent' : 'In force',
            pill: 'pill--debit',
            spent: false,
            term: entry?.permanent === true
                ? 'No end date'
                : (until ? `Until ${until}` : 'End date not recorded'),
        };
    }

    if (entry?.revoked === true) {
        const lifted = when(entry?.revokedAt);
        return {
            badge: 'Lifted',
            pill: 'pill--off',
            spent: true,
            term: lifted ? `Lifted ${lifted}` : 'Lifted in txAdmin',
        };
    }

    if (entry?.expired === true) {
        const ended = when(entry?.expiresAt);
        return {
            badge: 'Expired',
            pill: 'pill--off',
            spent: true,
            term: ended ? `Ended ${ended}` : 'Ended on a date that is not recorded',
        };
    }

    // Not in force, and the record does not say which way it ended. Saying
    // "expired" or "lifted" here would be inventing the half that did not
    // arrive.
    return { badge: 'Not in force', pill: 'pill--off', spent: true, term: null };
}

/**
 * The identifiers, sorted into the kinds they carry in front of the colon:
 * license, discord, ip, and whatever else a given txAdmin writes. Anything
 * without a prefix goes to "other" rather than being dropped - an
 * identifier this panel cannot categorise is still an identifier the ban
 * hangs off.
 */
function groupIdentifiers(list) {
    const groups = new Map();

    for (const raw of Array.isArray(list) ? list : []) {
        const value = text(raw);
        if (!value) continue;

        const colon = value.indexOf(':');
        const kind = colon > 0 ? value.slice(0, colon) : 'other';
        const rest = colon > 0 ? value.slice(colon + 1) : value;
        if (!rest) continue;

        if (!groups.has(kind)) groups.set(kind, []);
        groups.get(kind).push(rest);
    }

    return [...groups.entries()]
        .map(([kind, values]) => ({ kind, values }))
        .sort((a, b) => a.kind.localeCompare(b.kind));
}
