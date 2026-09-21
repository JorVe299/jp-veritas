import { useState } from 'react';
import { liftBan } from '../api';
import { DASH } from '../lib/portalText';
import { failureNote, successNote } from '../lib/writeFeedback';
import { formatDateTime } from '../utils/format';

/**
 * One row of the merged ban list.
 *
 * The list holds two records at once, so every row has to answer "where is
 * this written down" before anything else. That is not decoration: only a
 * row out of the database table can be lifted from this panel, and an
 * admin who reads a txAdmin ban as ours goes hunting for a button that is
 * not there. Hence a source marker on every single row, and on a txAdmin
 * row no control at all - not a disabled one, not a hint of one. A control
 * that cannot be honoured teaches the wrong thing about who holds the ban.
 *
 * How the entry stands is read from the server's flags and never worked
 * out again here. The order of the branches is the order the flags rank
 * in: a lifted ban is not in force however permanent it was, and an expiry
 * that has passed is not a block.
 *
 * `canEdit` comes from outside and is not justified here - the panel says
 * it once for all rows.
 */
export default function AllBansLine({ entry, canEdit, onFeedback, onChanged }) {
    const [confirming, setConfirming] = useState(false);
    const [busy, setBusy] = useState(false);

    const warning = entry?.type === 'warn';
    const fromDatabase = entry?.source === 'database';
    const state = stateOf(entry, warning);

    const identifiers = groupIdentifiers(entry?.identifiers);
    const identifierCount = identifiers.reduce((sum, group) => sum + group.values.length, 0);
    const characters = Array.isArray(entry?.characters) ? entry.characters : [];

    const reason = text(entry?.reason);
    const name = text(entry?.name);
    const issuedBy = text(entry?.issuedBy);
    const reference = text(entry?.nativeId);

    // Everything under the reason in reading order: who it is against,
    // which character record that turned out to be, who issued it, when it
    // began, how it ends, and what to quote when asking about it
    // elsewhere. Missing parts are left out rather than filled with a dash.
    const facts = [
        name ? { key: 'who', text: `Against ${name}` } : null,
        holderFact(entry, characters),
        issuedBy ? { key: 'by', text: `By ${issuedBy}` } : null,
        { key: 'issued', text: issuedLine(entry, fromDatabase) },
        state.term ? { key: 'term', text: state.term } : null,
        reference
            ? { key: 'ref', label: fromDatabase ? 'Row' : 'Action', text: reference, mono: true }
            : null,
    ].filter(Boolean);

    // Lifting deletes the row, so it takes two presses and no confirm()
    // dialog: the button changes its label and waits there.
    const handleLift = async () => {
        setBusy(true);
        onFeedback(null);
        try {
            const answer = await liftBan(entry.nativeId);
            onFeedback(successNote(answer, 'Ban lifted', 'The account can connect again.'));
            onChanged();
        } catch (err) {
            setConfirming(false);
            onFeedback(failureNote('The ban could not be lifted', err));
        } finally {
            setBusy(false);
        }
    };

    return (
        <li className={`line${state.spent ? ' line--spent' : ''}`}>
            <div className="line__top">
                <span className="line__name">{reason || 'No reason recorded'}</span>
                <span className="line__badges">
                    {/* Said on every row, in words rather than a shade:
                        which of the two records this one is written in. */}
                    <span className="pill pill--off line__src">
                        {fromDatabase ? 'Database' : 'txAdmin'}
                    </span>
                    <span className={`pill ${state.pill}`}>{state.badge}</span>
                </span>
            </div>

            <div className="line__meta">
                {facts.map((fact) => (
                    <span key={fact.key}>
                        {fact.label ? `${fact.label} ` : null}
                        <span className={fact.mono ? 'u-mono' : undefined}>{fact.text}</span>
                    </span>
                ))}
            </div>

            {/* The characters behind the ban and the identifiers it hangs
                off are what staff cross-reference by, and a run of hex
                strings across every row is noise on the ones nobody is
                cross-referencing. Folded away, grouped by kind, counted in
                the summary so it is worth opening only when it is. */}
            {(identifierCount > 0 || characters.length > 1) && (
                <details className="reveal line__ids">
                    <summary className="reveal__summary">
                        {revealSummary(characters, identifierCount, identifiers)}
                    </summary>
                    <div className="reveal__body">
                        {characters.length > 1 && (
                            <p className="line__idgroup">
                                <span className="line__idkind u-caps">Characters</span>
                                {characters.map((character) => (
                                    <span key={character.citizenid}>
                                        {text(character.name) || 'Unnamed'}
                                        {' '}
                                        <span className="u-mono">{character.citizenid}</span>
                                    </span>
                                ))}
                            </p>
                        )}
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

            {/* Only where the server said the row can be lifted. A txAdmin
                row arrives with canLift false and gets nothing at all. */}
            {entry?.canLift === true && (
                <>
                    {confirming && (
                        <p className="line__meta">
                            Lifting deletes this record. The account can connect again right away.
                        </p>
                    )}

                    <div className="line__actions">
                        {confirming ? (
                            <>
                                <button
                                    type="button"
                                    className="btn btn--danger btn--sm"
                                    onClick={handleLift}
                                    disabled={busy || !canEdit}
                                >
                                    {busy ? 'Lifting…' : 'Really lift'}
                                </button>
                                <button
                                    type="button"
                                    className="btn btn--ghost btn--sm"
                                    onClick={() => setConfirming(false)}
                                    disabled={busy}
                                >
                                    Keep
                                </button>
                            </>
                        ) : (
                            <button
                                type="button"
                                className="btn btn--ghost btn--sm"
                                onClick={() => { setConfirming(true); onFeedback(null); }}
                                disabled={busy || !canEdit}
                            >
                                Lift ban
                            </button>
                        )}
                    </div>
                </>
            )}
        </li>
    );
}

/** A trimmed string, or null - every one of these fields can arrive empty. */
function text(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null;
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed || null;
}

/** A timestamp, or null where there is none - never a sentence trailing into a dash. */
function when(value) {
    const shown = formatDateTime(value);
    return shown === DASH ? null : shown;
}

/**
 * When the ban was issued.
 *
 * The bans table has no created-at column, so its rows genuinely carry no
 * date. A blank there would read as "just now" and a date worked out from
 * the row id would be a number dressed up as a fact, so the row says which
 * of the two cases it is: the table records none, or txAdmin's entry
 * happens to be missing one.
 */
function issuedLine(entry, fromDatabase) {
    const issued = entry?.issuedAtKnown === true ? when(entry?.issuedAt) : null;
    if (issued) return `Issued ${issued}`;
    if (fromDatabase) return 'The bans table records no issue date';
    return 'Issue date not recorded';
}

/**
 * Whose ban this is, in character terms.
 *
 * A ban hangs off a license, a Discord ID or an IP, and an account can
 * hold several characters - so the server states a citizenid only where
 * there is exactly one. Picking one out of several would name the wrong
 * person half the time, and naming none at all would hide that the ban
 * reaches all of them. Both other cases are therefore said out loud.
 */
function holderFact(entry, characters) {
    const citizenid = text(entry?.citizenid);
    if (citizenid) return { key: 'holder', label: 'Citizen', text: citizenid, mono: true };
    if (characters.length > 1) {
        return { key: 'holder', text: `${characters.length} characters on this account` };
    }
    return { key: 'holder', text: 'No character in this database carries these identifiers' };
}

function revealSummary(characters, identifierCount, identifiers) {
    const parts = [];
    if (characters.length > 1) parts.push(`${characters.length} characters`);
    if (identifierCount > 0) {
        parts.push(`${identifierCount} identifier${identifierCount === 1 ? '' : 's'}`);
        parts.push(identifiers.map((group) => group.kind).join(', '));
    }
    return parts.join(' · ');
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

    // A lifted ban is not in force however permanent it was, so this
    // branch stands ahead of the expiry one.
    if (entry?.revoked === true) {
        const lifted = when(entry?.revokedAt);
        return {
            badge: 'Lifted',
            pill: 'pill--off',
            spent: true,
            term: lifted ? `Lifted ${lifted}` : 'Lifted at the source',
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
 * license, discord, ip, and whatever else a given source writes. Anything
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
