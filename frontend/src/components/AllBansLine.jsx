import { useState } from 'react';
import { deleteBanHistory, liftBan } from '../api';
import { DASH } from '../lib/portalText';
import { failureNote, successNote } from '../lib/writeFeedback';
import { formatDateTime } from '../utils/format';

// Source in words on every row: only database rows can be lifted, only history rows deleted
const SOURCE_LABELS = { database: 'Database', txadmin: 'txAdmin', history: 'History' };

/** Row of the merged ban list (table, txAdmin, panel history); !canEdit explained by the panel */
export default function AllBansLine({ entry, canEdit, canDeleteHistory = false, onFeedback, onChanged }) {
    const [confirming, setConfirming] = useState(false);
    const [busy, setBusy] = useState(false);

    const warning = entry?.type === 'warn';
    const fromDatabase = entry?.source === 'database';
    const fromHistory = entry?.source === 'history';
    const state = stateOf(entry, warning);

    const identifiers = groupIdentifiers(entry?.identifiers);
    const identifierCount = identifiers.reduce((sum, group) => sum + group.values.length, 0);
    const characters = Array.isArray(entry?.characters) ? entry.characters : [];

    const reason = text(entry?.reason);
    const name = text(entry?.name);
    const issuedBy = text(entry?.issuedBy);
    const reference = text(entry?.nativeId);

    // Reading order under the reason; missing parts are dropped, never shown as a dash
    const facts = [
        name ? { key: 'who', text: `Against ${name}` } : null,
        holderFact(entry, characters),
        issuedBy ? { key: 'by', text: `By ${issuedBy}` } : null,
        { key: 'issued', text: issuedLine(entry, fromDatabase) },
        state.term ? { key: 'term', text: state.term } : null,
        fromHistory && text(entry?.revokedBy) ? { key: 'liftedby', text: `Lifted by ${text(entry.revokedBy)}` } : null,
        reference
            ? { key: 'ref', label: fromDatabase || fromHistory ? 'Row' : 'Action', text: reference, mono: true }
            : null,
    ].filter(Boolean);

    const handleDeleteHistory = async () => {
        setBusy(true);
        onFeedback(null);
        try {
            await deleteBanHistory(entry.historyId);
            onFeedback({ tone: 'success', title: 'History entry deleted' });
            onChanged();
        } catch (err) {
            setConfirming(false);
            onFeedback(failureNote('The entry could not be deleted', err));
        } finally {
            setBusy(false);
        }
    };

    // Deletes the row: two presses via the button label, no confirm() dialog
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
                    <span className="pill pill--off line__src">
                        {SOURCE_LABELS[entry?.source] ?? 'Unknown'}
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

            {/* Folded: hex identifiers on every row are noise; the summary counts them */}
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

            {fromHistory && canDeleteHistory && entry?.historyId && (
                <div className="line__actions">
                    {confirming ? (
                        <>
                            <button
                                type="button"
                                className="btn btn--danger btn--sm"
                                onClick={handleDeleteHistory}
                                disabled={busy}
                            >
                                {busy ? 'Deleting…' : 'Delete entry'}
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
                        >
                            Delete
                        </button>
                    )}
                </div>
            )}

            {/* txAdmin rows (canLift false) get no control, not even a disabled one */}
            {entry?.canLift === true && (
                <>
                    {confirming && (
                        <p className="line__meta">
                            Deletes the record; they can connect again at once.
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

function text(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null;
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed || null;
}

// Null instead of DASH, so no sentence ends in a dash
function when(value) {
    const shown = formatDateTime(value);
    return shown === DASH ? null : shown;
}

// The bans table has no created-at column: say so; a blank reads as "just now",
// and a date derived from the row id would be invented
function issuedLine(entry, fromDatabase) {
    const issued = entry?.issuedAtKnown === true ? when(entry?.issuedAt) : null;
    if (issued) return `Issued ${issued}`;
    if (fromDatabase) return 'The bans table records no issue date';
    return 'Issue date not recorded';
}

// Server sends a citizenid only for exactly one character; never pick one out of several
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

// The server's flag, never recomputed here
function inForce(entry) {
    return entry?.active === true;
}

function stateOf(entry, warning) {
    // A warning blocks nobody: no in-force or expired wording
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

    // Branch order is flag rank: lifted outranks expired
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

    // Record does not say how it ended: never guess expired or lifted
    return { badge: 'Not in force', pill: 'pill--off', spent: true, term: null };
}

// Grouped by prefix; unprefixed values go to "other", never dropped: the ban hangs off them too
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
