import { Fragment } from 'react';
import Icon from './Icon';
import PortalNotice from './PortalNotice';
import StatusNote from './StatusNote';
import { usePortalBans } from '../lib/usePortal';
import { DASH, numberOrNull } from '../lib/portalText';
import { formatDateTime } from '../utils/format';

/**
 * What txAdmin has on record against this account.
 *
 * It sits on the front door rather than inside a character because that is
 * what a txAdmin ban is: it is issued against identifiers, so it follows
 * the person through every character they have. Put under one of them it
 * would read as a fact about that character, and the others as unaffected.
 *
 * Three answers, and the third is the one everything here is built around:
 *
 *   available: true, with records  - the record, read
 *   available: true, with none     - nothing on file
 *   available: false               - nobody could look
 *
 * The last is not the middle one. A player told "you are clear" by a panel
 * that never managed to open the store has been told something nobody
 * checked, and on this subject that is the worst thing the page could do.
 * So the unreachable case is never drawn as a clean record: it is named,
 * in the server's own words, and it keeps the section standing.
 *
 * Nothing here suggests anything can be done about a ban from this page.
 * There is no route for it, and a button, a form or even the word "appeal"
 * would be an offer the portal cannot keep.
 */
export default function PortalBans() {
    const state = usePortalBans();

    const bans = Array.isArray(state.data?.bans) ? state.data.bans : [];
    // Only an explicit false means the record could not be read. A missing
    // field is not a denial and must not be read as one.
    const unreadable = state.status === 'ready' && state.data?.available === false;

    // The server counts; the list is only what it sent. Where the two
    // disagree the count is what is said out loud, the same way the roster
    // does it - it is the server's own answer about this account.
    const counted = numberOrNull(state.data?.count);
    const count = counted ?? bans.length;
    const activeCount = numberOrNull(state.data?.activeCount) ?? bans.filter(inForce).length;

    // The author is a server setting, not a property of one ban: with it
    // off, no ban carries a name and none should pretend to.
    const showsAuthor = state.data?.showsAuthor === true;

    // Nothing has been read yet. One line, in the place the answer will
    // stand, so that a record arriving does not shove the page around.
    if (state.status === 'loading') {
        return (
            <p className="idbans__quiet" role="status">
                Checking the ban record for this account…
            </p>
        );
    }

    // Read, and empty. Deliberately not a panel: a titled, bordered "Bans"
    // block standing empty on every visit is a question asked of somebody
    // who was never suspected of anything. One sentence, stated and left
    // alone - no praise, no reassurance, nothing to click.
    if (state.status === 'ready' && !unreadable && count === 0 && bans.length === 0) {
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
                    />
                )}

                {unreadable && <Unreadable data={state.data} onRetry={state.reload} />}

                {state.status === 'ready' && !unreadable && (
                    <Record
                        bans={bans}
                        counted={counted}
                        activeCount={activeCount}
                        showsAuthor={showsAuthor}
                    />
                )}
            </div>
        </section>
    );
}

/** Whether this row is in force. Read from the server's field, not worked out. */
function inForce(ban) {
    return ban?.active === true;
}

/**
 * The store could not be read.
 *
 * The server's `reason` is the sentence, because it is the only party that
 * knows why. `hint` is written for whoever runs the server - it talks about
 * configuration - so it folds away instead of standing in front of a player
 * who has no .env to edit. Folded, not dropped: the operator is often the
 * same person, and they should not have to open a console to find it.
 */
function Unreadable({ data, onRetry }) {
    const reason = typeof data?.reason === 'string' ? data.reason.trim() : '';
    const hint = typeof data?.hint === 'string' ? data.hint.trim() : '';

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

            {hint && (
                <details className="reveal idbans__more">
                    <summary className="reveal__summary">Details for whoever runs this server</summary>
                    <p className="reveal__body idbans__hint">{hint}</p>
                </details>
            )}

            <button type="button" className="btn btn--ghost btn--sm idbans__retry" onClick={onRetry}>
                Try again
            </button>
        </>
    );
}

/**
 * The record itself.
 *
 * In force first, over afterwards, and each group in the order the server
 * sent it - newest first. Grouping is the whole of the emphasis: what
 * applies today is not mixed in among what does not, and neither group
 * needs a colour to be told apart from the other.
 */
function Record({ bans, counted, activeCount, showsAuthor }) {
    const standing = bans.filter(inForce);
    const over = bans.filter((ban) => !inForce(ban));
    const split = standing.length > 0 && over.length > 0;

    return (
        <>
            <p className="idbans__lead">
                <strong className="idbans__verdict">{verdict(activeCount)}</strong>{' '}
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

            {/* The server said one number and sent another. Said plainly
                rather than smoothed over - which of the two is right is not
                something this page can know, and on this record a row that
                quietly went missing matters. */}
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

/** The one line that answers the question the reader came with. */
function verdict(activeCount) {
    if (activeCount <= 0) return 'No ban on this record is in force.';
    if (activeCount === 1) return 'One ban is in force.';
    return `${activeCount} bans are in force.`;
}

function BanGroup({ title, bans, showsAuthor }) {
    return (
        <div className="idbans__group">
            {title && <h3 className="idbans__grouptitle u-caps">{title}</h3>}
            <ul className="idbans__items">
                {bans.map((ban, index) => (
                    /* The txAdmin id is the natural key, but it can be null
                       and two rows could share that; the index keeps the
                       list stable either way. */
                    <li key={`${ban?.id ?? 'entry'}-${index}`}>
                        <BanRow ban={ban} showsAuthor={showsAuthor} />
                    </li>
                ))}
            </ul>
        </div>
    );
}

/** A timestamp, or null where there is none - never a sentence trailing into a dash. */
function when(value) {
    const text = formatDateTime(value);
    return text === DASH ? null : text;
}

/**
 * How a ban stands, in words taken from the fields rather than worked out
 * again here. The order of the branches is the order the server's own
 * flags rank in: a lifted ban is never active however permanent it was,
 * and an expiry that has passed is not a block.
 */
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

    // Not in force, and the record does not say which way it ended. Saying
    // "expired" or "lifted" here would be inventing the half the server
    // did not send.
    return { badge: 'Not in force', pill: 'pill--off', term: null };
}

function BanRow({ ban, showsAuthor }) {
    const state = stateOf(ban);
    const standing = inForce(ban);
    const issued = when(ban?.issuedAt);

    // Everything under the reason, in one line and in reading order: when
    // it began, how it ends, who issued it, what to quote when asking about
    // it. Missing parts are left out rather than filled with a dash.
    const facts = [
        { key: 'issued', text: issued ? `Issued ${issued}` : 'Issue date not recorded' },
        state.term ? { key: 'term', text: state.term } : null,
        showsAuthor && typeof ban?.author === 'string' && ban.author.trim()
            ? { key: 'author', text: `By ${ban.author.trim()}` }
            : null,
        // Named rather than left as a bare code: it is the thing to quote
        // when asking the staff about this entry, and nothing else on the
        // row looks like an identifier.
        typeof ban?.id === 'string' && ban.id.trim()
            ? { key: 'id', label: 'Reference', text: ban.id.trim(), mono: true }
            : null,
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
