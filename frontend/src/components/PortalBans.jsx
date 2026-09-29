import { Fragment } from 'react';
import CooldownLabel from './CooldownLabel';
import Icon from './Icon';
import PortalNotice from './PortalNotice';
import StatusNote from './StatusNote';
import { useCooldown } from '../lib/useCooldown';
import { usePortalBans } from '../lib/usePortal';
import { DASH, numberOrNull } from '../lib/portalText';
import { formatDateTime } from '../utils/format';

const RETRY_KEY = 'portal-bans-retry';

/**
 * Account-level ban record; bans follow identifiers, so it sits outside any character
 * States: loading, clean, partial (entries + named gap), unreadable (never shown as clean)
 * Read-only: no contest/appeal affordance (no route for it)
 */
export default function PortalBans() {
    const state = usePortalBans();

    // One cooldown for all three retry buttons: same request
    const retryCooldown = useCooldown(RETRY_KEY);
    const retry = () => {
        retryCooldown.start();
        state.reload();
    };

    const bans = Array.isArray(state.data?.bans) ? state.data.bans : [];

    // Only an explicit false counts as unavailable; a missing field is not a denial
    const sources = state.data?.sources && typeof state.data.sources === 'object'
        ? state.data.sources
        : {};
    const missing = SOURCE_KEYS.filter((key) => sources[key]?.available === false);
    const incomplete = state.status === 'ready'
        && (state.data?.available === false || missing.length > 0);

    const unreadable = incomplete && bans.length === 0;
    const partial = incomplete && bans.length > 0;

    // The server's count wins over the list length, as in the roster
    const counted = numberOrNull(state.data?.count);
    const count = counted ?? bans.length;
    const activeCount = numberOrNull(state.data?.activeCount) ?? bans.filter(inForce).length;

    // Author visibility is a server setting, not per ban
    const showsAuthor = state.data?.showsAuthor === true;

    // Same slot as the answer: no layout shift on arrival
    if (state.status === 'loading') {
        return (
            <p className="idbans__quiet" role="status">
                Checking the ban record for this account…
            </p>
        );
    }

    // Only with every record read: unreadable is never shown as clean
    // One sentence, no panel or reassurance: an empty "Bans" box reads as suspicion
    if (state.status === 'ready' && !incomplete && count === 0 && bans.length === 0) {
        return (
            <p className="idbans__quiet">No bans are on record for this account.</p>
        );
    }

    return (
        <section className="idpanel idbans" aria-labelledby="id-bans">
            <header className="idpanel__head">
                <Icon name="ban" size={18} className="idpanel__icon" />
                <h2 className="idpanel__title" id="id-bans">Ban record</h2>
                {state.status === 'ready' && !unreadable && (
                    <span className="idpanel__count u-mono">{count}</span>
                )}
            </header>

            <div className="idpanel__body">
                {state.status === 'failed' && (
                    <PortalNotice
                        code={state.code}
                        error={state.error}
                        hint={state.hint}
                        onRetry={state.reload}
                        cooldownKey={RETRY_KEY}
                    />
                )}

                {unreadable && (
                    <Unreadable data={state.data} onRetry={retry} wait={retryCooldown.remaining} />
                )}

                {/* Above the entries: the gap is read before any entry */}
                {partial && <PartialGap data={state.data} missing={missing} />}

                {state.status === 'ready' && !unreadable && (
                    <Record
                        bans={bans}
                        counted={counted}
                        activeCount={activeCount}
                        showsAuthor={showsAuthor}
                        partial={partial}
                    />
                )}

                {partial && (
                    <button
                        type="button"
                        className="btn btn--ghost btn--sm idbans__retry"
                        onClick={retry}
                        disabled={!retryCooldown.ready}
                    >
                        <CooldownLabel text="Try again" remaining={retryCooldown.remaining} />
                    </button>
                )}
            </div>
        </section>
    );
}

// The server's flag, never derived from dates
function inForce(ban) {
    return ban?.active === true;
}

// Named for players: a ban kept in both lists appears twice; each row says which list
const SOURCES = {
    database: {
        name: "this community's own ban list",
        row: "In this community's own ban list",
    },
    txadmin: {
        name: "the server software's ban list",
        row: "In the server software's ban list",
    },
};

const SOURCE_KEYS = Object.keys(SOURCES);

function trimmed(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

// Names the failed record, so a reader can tell whether a ban they know of sat there
function PartialGap({ data, missing }) {
    const names = missing.map((key) => SOURCES[key].name);

    // Same voice as Unreadable: what the page could not read
    const which = names.length > 0
        ? `This page could not read ${names.join(' and ')}`
        : 'Part of the ban record could not be read';

    // Top-level reason holds only the first failure: a guess once both records are down
    const only = missing.length === 1 ? data?.sources?.[missing[0]] : null;
    const reason = only ? (trimmed(only.reason) ?? trimmed(data?.reason)) : null;
    const hint = only ? (trimmed(only.hint) ?? trimmed(data?.hint)) : trimmed(data?.hint);

    const missed = names.length === 1
        ? 'so any ban recorded only there is not below'
        : 'so this list may not be all of it';

    return (
        <>
            <StatusNote
                tone="warn"
                title="This list may be incomplete"
                detail={
                    reason
                        ? `${which}, ${missed}. Reported: ${reason}`
                        : `${which}, ${missed}, and the server did not say why.`
                }
            />

            {hint && <Hint text={hint} />}
        </>
    );
}

function Unreadable({ data, onRetry, wait }) {
    const reason = trimmed(data?.reason);
    const hint = trimmed(data?.hint);

    return (
        <>
            <StatusNote
                tone="warn"
                title="The ban record could not be read"
                detail={
                    reason
                        ? `This page cannot say whether anything is on record for this account. Reported: ${reason}`
                        : 'This page cannot say whether anything is on record for this account, and the server did not say why.'
                }
            />

            {hint && <Hint text={hint} />}

            <button
                type="button"
                className="btn btn--ghost btn--sm idbans__retry"
                onClick={onRetry}
                disabled={wait > 0}
            >
                <CooldownLabel text="Try again" remaining={wait} />
            </button>
        </>
    );
}

// Operator-facing config advice: folded, not dropped; the operator is often a player too
function Hint({ text }) {
    return (
        <details className="reveal idbans__more">
            <summary className="reveal__summary">Details for whoever runs this server</summary>
            <p className="reveal__body idbans__hint">{text}</p>
        </details>
    );
}

// Grouping is the only emphasis, no colour; server order (newest first) kept within groups
function Record({ bans, counted, activeCount, showsAuthor, partial }) {
    const standing = bans.filter(inForce);
    const over = bans.filter((ban) => !inForce(ban));
    const split = standing.length > 0 && over.length > 0;

    return (
        <>
            <p className="idbans__lead">
                <strong className="idbans__verdict">{verdict(activeCount, partial)}</strong>{' '}
                A ban is recorded against this account rather than against one character,
                so it covers every character on it.
            </p>

            {split ? (
                <>
                    <BanGroup title="In force" bans={standing} showsAuthor={showsAuthor} />
                    <BanGroup title="No longer in force" bans={over} showsAuthor={showsAuthor} />
                </>
            ) : (
                bans.length > 0 && <BanGroup bans={bans} showsAuthor={showsAuthor} />
            )}

            {/* Count/list mismatch said plainly: a silently missing ban row matters */}
            {counted !== null && counted !== bans.length && (
                <p className="idbans__gap">
                    This account is recorded as having {counted}{' '}
                    {counted === 1 ? 'entry' : 'entries'}, and {bans.length} came through.
                    Ask the server staff if that looks wrong.
                </p>
            )}
        </>
    );
}

// Partial: scoped to what was read; a bare "no ban in force" would claim a clean record
function verdict(activeCount, partial) {
    if (activeCount <= 0) {
        return partial
            ? 'No ban is in force in the part of the record that could be read.'
            : 'No ban on this record is in force.';
    }
    if (activeCount === 1) return partial ? 'At least one ban is in force.' : 'One ban is in force.';
    return partial
        ? `At least ${activeCount} bans are in force.`
        : `${activeCount} bans are in force.`;
}

function BanGroup({ title, bans, showsAuthor }) {
    return (
        <div className="idbans__group">
            {title && <h3 className="idbans__grouptitle u-caps">{title}</h3>}
            <ul className="idbans__items">
                {bans.map((ban, index) => (
                    /* Ids repeat across the two records and may be missing */
                    <li key={`${ban?.source ?? 'record'}-${ban?.id ?? 'entry'}-${index}`}>
                        <BanRow ban={ban} showsAuthor={showsAuthor} />
                    </li>
                ))}
            </ul>
        </div>
    );
}

// null, not DASH: a sentence must not trail into a dash
function when(value) {
    const text = formatDateTime(value);
    return text === DASH ? null : text;
}

// String id in one record, numeric row id in the other
function reference(id) {
    if (typeof id === 'number' && Number.isFinite(id)) return String(id);
    if (typeof id === 'string' && id.trim()) return id.trim();
    return null;
}

// `issuedAtKnown: false`: that record keeps no dates at all; said as such,
// never left blank (reads as "just now") nor guessed from the row id
function issuedText(ban) {
    const issued = when(ban?.issuedAt);
    if (issued) return `Issued ${issued}`;
    if (ban?.issuedAtKnown === false) return 'This record keeps no date';
    return 'Issue date not recorded';
}

// From the server's flags, not dates; branch order is the flags' precedence
function stateOf(ban) {
    if (inForce(ban)) {
        const until = when(ban?.expiresAt);
        return {
            badge: 'In force',
            pill: 'pill--debit',
            term: ban?.permanent === true
                ? 'No end date'
                : (until ? `Until ${until}` : 'End date not recorded'),
        };
    }

    if (ban?.revoked === true) {
        const lifted = when(ban?.revokedAt);
        return {
            badge: 'Lifted',
            pill: 'pill--off',
            term: lifted ? `Lifted ${lifted}` : 'Lifted by staff',
        };
    }

    if (ban?.expired === true) {
        const ended = when(ban?.expiresAt);
        return {
            badge: 'Ended',
            pill: 'pill--off',
            term: ended ? `Ended ${ended}` : 'Ended on a date that is not recorded',
        };
    }

    // Neither flag set: no guess at expired vs lifted
    return { badge: 'Not in force', pill: 'pill--off', term: null };
}

function BanRow({ ban, showsAuthor }) {
    const state = stateOf(ban);
    const standing = inForce(ban);
    const source = SOURCES[ban?.source] ?? null;
    const id = reference(ban?.id);

    // Missing facts are left out, not dashed
    // Source next to the id it scopes; plain text, not a badge: it ranks below "in force"
    const facts = [
        { key: 'issued', text: issuedText(ban) },
        state.term ? { key: 'term', text: state.term } : null,
        showsAuthor && typeof ban?.issuedBy === 'string' && ban.issuedBy.trim()
            ? { key: 'author', text: `By ${ban.issuedBy.trim()}` }
            : null,
        // Unknown source values are omitted, never printed raw
        source ? { key: 'source', text: source.row } : null,
        // Labelled: it is what to quote to staff
        id ? { key: 'id', label: 'Reference', text: id, mono: true } : null,
    ].filter(Boolean);

    const reason = typeof ban?.reason === 'string' && ban.reason.trim() ? ban.reason.trim() : null;

    return (
        <article className={`idban${standing ? ' idban--standing' : ''}`}>
            <div className="idban__top">
                <span className="idban__reason">{reason || 'No reason was recorded'}</span>
                <span className={`pill ${state.pill}`}>{state.badge}</span>
            </div>

            <p className="idban__meta">
                {facts.map((fact, index) => (
                    <Fragment key={fact.key}>
                        {index > 0 && <span className="idrow__sep" aria-hidden="true">·</span>}
                        <span>
                            {fact.label ? `${fact.label} ` : null}
                            <span className={fact.mono ? 'u-mono' : undefined}>{fact.text}</span>
                        </span>
                    </Fragment>
                ))}
            </p>
        </article>
    );
}
