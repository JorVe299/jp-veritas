import { Fragment } from 'react';
import Icon from './Icon';
import PortalNotice from './PortalNotice';
import StatusNote from './StatusNote';
import { usePortalBans } from '../lib/usePortal';
import { DASH, numberOrNull } from '../lib/portalText';
import { formatDateTime } from '../utils/format';

/**
 * What is on record against this account.
 *
 * It sits on the front door rather than inside a character because that is
 * what a ban is: it is issued against identifiers, so it follows the person
 * through every character they have. Put under one of them it would read as
 * a fact about that character, and the others as unaffected.
 *
 * Two records answer that question - the one this community's staff write
 * through the panel, and the one the server software keeps - and the server
 * reads them separately. So there are four answers, not three:
 *
 *   both records read, with entries   - the record, read
 *   both records read, with none      - nothing on file
 *   one read, one not                 - what there is, and what is missing
 *   neither read                      - nobody could look
 *
 * The last is not the second. A player told "you are clear" by a panel that
 * never managed to open the record has been told something nobody checked,
 * and on this subject that is the worst thing the page could do. So the
 * unreachable case is never drawn as a clean record: it is named, in the
 * server's own words, and it keeps the section standing.
 *
 * The third is not the last either. Half an answer thrown away because the
 * other half failed is a ban the reader had every right to see, hidden by a
 * problem that has nothing to do with them. So the entries that did arrive
 * are shown, with the gap named above them - and the verdict at the top
 * stops short of claiming anything about the part nobody could read.
 *
 * Nothing here suggests anything can be done about a ban from this page.
 * There is no route for it, and a button, a form or even a word inviting
 * the reader to contest one would be an offer the portal cannot keep.
 */
export default function PortalBans() {
    const state = usePortalBans();

    const bans = Array.isArray(state.data?.bans) ? state.data.bans : [];

    // Which records could not be read. `available` on the body is the
    // conservative summary - false the moment any one of them failed - and
    // `sources` is the detail behind it. Only an explicit false is a
    // denial: a missing field is not one and must not be read as one.
    const sources = state.data?.sources && typeof state.data.sources === 'object'
        ? state.data.sources
        : {};
    const missing = SOURCE_KEYS.filter((key) => sources[key]?.available === false);
    const incomplete = state.status === 'ready'
        && (state.data?.available === false || missing.length > 0);

    // The same gap, drawn two ways, and which one depends on whether
    // anything survived it. With entries in hand the list leads and the gap
    // is named over it; with none, there is nothing to lead with and the
    // page can only say that nobody managed to look.
    const unreadable = incomplete && bans.length === 0;
    const partial = incomplete && bans.length > 0;

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
                    />
                )}

                {unreadable && <Unreadable data={state.data} onRetry={state.reload} />}

                {/* Above the entries, not below them: a reader who stops
                    after the first one they recognise still has to have
                    been told the list may not be all of it. */}
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
                        onClick={state.reload}
                    >
                        Try again
                    </button>
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
 * The two records, in words a player can place.
 *
 * The server calls them "database" and "txadmin". Both are the names of
 * software, and neither tells the person reading anything about their own
 * ban. What does matter to them is that the same ban can honestly be
 * written down twice - a server that bans in both places produces two
 * entries with the same reason - and that without saying where each one
 * sits, that duplicate reads as a fault in this page.
 *
 * So each record is named by what it is to them: the list this community
 * keeps, and the list the software the server runs on keeps.
 */
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

/** The server's sentence for a record that failed, or null. */
function trimmed(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Part of the record is missing, and part of it is on the screen.
 *
 * Named over the entries rather than folded in among them, because it does
 * not qualify any one of them - it qualifies the list. The record that
 * failed is named, so that a reader who knows a ban exists can tell whether
 * this is where it should have been.
 */
function PartialGap({ data, missing }) {
    const names = missing.map((key) => SOURCES[key].name);

    // The same voice the fully unreachable case speaks in: the page says
    // what it could not do, rather than the record being described as
    // having failed at the reader.
    const which = names.length > 0
        ? `This page could not read ${names.join(' and ')}`
        : 'Part of the ban record could not be read';

    // The reason belongs to whichever record failed, so it is taken from
    // that record. The body carries a copy at the top level, but only of
    // the first failure - with one record down the two agree, and with
    // both, pinning the top-level sentence to either by name is a guess.
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

            <button type="button" className="btn btn--ghost btn--sm idbans__retry" onClick={onRetry}>
                Try again
            </button>
        </>
    );
}

/** The operator's half of a failure, folded away from the player's half. */
function Hint({ text }) {
    return (
        <details className="reveal idbans__more">
            <summary className="reveal__summary">Details for whoever runs this server</summary>
            <p className="reveal__body idbans__hint">{text}</p>
        </details>
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

/**
 * The one line that answers the question the reader came with.
 *
 * With a record missing it answers a smaller question, and says so. "No ban
 * is in force" is a statement about every record there is; on half of them
 * it is not something this page knows, and stating it anyway would be the
 * clean-record lie told one level up from the list.
 */
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
                    /* The id is the natural key, but the two records number
                       their entries independently, so it is unique only
                       next to the source - and it can be missing from
                       either. The index keeps the list stable regardless. */
                    <li key={`${ban?.source ?? 'record'}-${ban?.id ?? 'entry'}-${index}`}>
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

/** The entry's own number, from either record. A string in one, a row id in the other. */
function reference(id) {
    if (typeof id === 'number' && Number.isFinite(id)) return String(id);
    if (typeof id === 'string' && id.trim()) return id.trim();
    return null;
}

/**
 * When the ban was issued, including the case where the answer is that
 * nobody knows.
 *
 * `issuedAtKnown: false` is not a value that went astray on the way here:
 * the record holding that entry has no date in it at all. That is a fact
 * about the record and it gets said in as many words. A blank would read as
 * "just now", and a date worked back from a row number would be a guess
 * printed in the same type as the truth.
 */
function issuedText(ban) {
    const issued = when(ban?.issuedAt);
    if (issued) return `Issued ${issued}`;
    if (ban?.issuedAtKnown === false) return 'This record keeps no date';
    return 'Issue date not recorded';
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
    const source = SOURCES[ban?.source] ?? null;
    const id = reference(ban?.id);

    // Everything under the reason, in one line and in reading order: when
    // it began, how it ends, who issued it, where it is written down and
    // what to quote when asking about it. Missing parts are left out rather
    // than filled with a dash.
    //
    // The record it sits in goes last but one, next to the number that only
    // means anything within that record, and it stays in this line rather
    // than becoming a second badge: where a ban is kept is worth knowing,
    // and it is not worth as much as whether the ban is in force.
    const facts = [
        { key: 'issued', text: issuedText(ban) },
        state.term ? { key: 'term', text: state.term } : null,
        showsAuthor && typeof ban?.issuedBy === 'string' && ban.issuedBy.trim()
            ? { key: 'author', text: `By ${ban.issuedBy.trim()}` }
            : null,
        // Only the two records this page knows how to name. An unfamiliar
        // value is left off rather than printed raw - a word out of the
        // server's internals in the middle of a sentence about a ban is
        // worse than no word at all.
        source ? { key: 'source', text: source.row } : null,
        // Named rather than left as a bare code: it is the thing to quote
        // when asking the staff about this entry, and nothing else on the
        // row looks like an identifier.
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
