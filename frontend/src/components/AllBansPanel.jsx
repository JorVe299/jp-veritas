import { useState } from 'react';
import AllBansLine from './AllBansLine';
import Icon from './Icon';
import PermissionLine from './PermissionLine';
import StatusNote from './StatusNote';
import { numberOrNull } from '../lib/portalText';
import { useAllBans } from '../lib/useAllBans';
import { useCan } from '../lib/useCan';

const LIMIT = 50;

/**
 * Everyone kept out, out of both records at once.
 *
 * This panel replaces the two that stood here before - one for the
 * database table, one for txAdmin's file. Two lists side by side made the
 * gap visible but left the work to the reader: a server bans in two places
 * that know nothing about each other, and nobody asking "is this person
 * banned" cares which file the answer came out of. So the rows are merged
 * and sorted together.
 *
 * Three things the merge is not allowed to blur, and everything below is
 * shaped by them:
 *
 *   Where a row is written down stays on the row. Only a database row can
 *   be lifted from here; a txAdmin row is managed in txAdmin and carries
 *   no control at all. The source marker is what makes that legible
 *   instead of surprising.
 *
 *   A source that could not be read is not an absence of bans. The route
 *   answers that with 200 and says so per source, and this panel says it
 *   above the rows - loudly enough that a short list is never mistaken for
 *   the whole truth. That failure is the exact one the merge was built to
 *   undo, and merging makes it easier to miss, not harder.
 *
 *   The order is the server's: in force first, then newest. There is no
 *   sort control, because that order is the reason the list is readable at
 *   all - the question is always "who is kept out right now", and every
 *   other order buries the answer among entries that are over.
 */
export default function AllBansPanel({ citizenid = '', onClearCitizen }) {
    const { can } = useCan();
    const canEdit = can('bans.edit');

    const [search, setSearch] = useState('');
    const [activeOnly, setActiveOnly] = useState(false);
    const [includeWarnings, setIncludeWarnings] = useState(false);
    const [source, setSource] = useState(''); // '' | 'database' | 'txadmin'
    const [token, setToken] = useState(0);
    const [feedback, setFeedback] = useState(null);

    // The page belongs to one set of filters. Rather than an effect that
    // chases the filters and resets it - which would be a synchronous
    // setState in an effect for a value that is plainly derivable - the
    // page carries the filters it was chosen under. Change any of them and
    // it falls back to the first page by itself.
    const filterKey = [search, citizenid, activeOnly, includeWarnings, source].join('\u0000');
    const [pageAt, setPageAt] = useState({ key: filterKey, value: 1 });
    const page = pageAt.key === filterKey ? pageAt.value : 1;

    const res = useAllBans({
        search, citizenid, activeOnly, includeWarnings, source, page, limit: LIMIT, token,
    });

    const data = res.data || {};
    const ready = res.status === 'ready';
    const rows = Array.isArray(data.bans) ? data.bans : [];

    const sources = data.sources || {};
    // Which source the answer was actually assembled from. Read from the
    // answer rather than from the control, so the sentences below describe
    // the list on screen and not the request in flight.
    const applied = data.filter?.source || null;
    const databaseAsked = applied !== 'txadmin';
    const txadminAsked = applied !== 'database';

    // available:false only counts as a failure for a source that was
    // actually asked. One left out by the source filter is absent on
    // purpose, and calling that a failure would cry wolf.
    const databaseFailed = ready && databaseAsked && sources.database?.available === false;
    const txadminFailed = ready && txadminAsked && sources.txadmin?.available === false;
    const failedCount = (databaseFailed ? 1 : 0) + (txadminFailed ? 1 : 0);

    const count = numberOrNull(data.count) ?? 0;
    const activeCount = numberOrNull(data.activeCount) ?? 0;
    const pages = Math.max(numberOrNull(data.pages) ?? 1, 1);

    const identity = data.identity || null;
    // A citizen with no license, no Discord ID and no IP on record cannot
    // match a ban, because a ban hangs off exactly those. An empty list
    // then says nothing about that person, so it is not left to speak.
    const unmatchable = ready && Boolean(citizenid) && identity?.identifiers === 0;

    const goPage = (next) => {
        setPageAt({ key: filterKey, value: Math.max(1, next) });
        setFeedback(null);
    };

    const change = (setter) => (value) => {
        setter(value);
        setFeedback(null);
    };

    const reload = () => setToken((v) => v + 1);

    return (
        <section className="panel" aria-labelledby="allbans-panel-title">
            <header className="panel__head">
                <Icon name="ban" size={18} className="panel__icon" />
                <div>
                    <h2 className="panel__title" id="allbans-panel-title">Everyone kept out</h2>
                    <p className="panel__hint">
                        {headHint(res, count, activeCount, page, pages, failedCount)}
                    </p>
                </div>
            </header>

            <div className="panel__body">
                {!canEdit && <PermissionLine what="lift bans" />}

                <p className="field__hint">
                    Both ban records in one list: the <strong>bans</strong> table in the
                    server&rsquo;s database, which this panel writes, and txAdmin&rsquo;s own record,
                    a file beside the server that this panel can only read. A ban blocks a license,
                    a Discord ID or an IP — not a character — so entries with no character in this
                    database behind them are findable here and nowhere else in the panel.
                </p>

                <p className="field__hint">
                    Every row says which record it comes from. Only a <strong>Database</strong> row
                    can be lifted here; a <strong>txAdmin</strong> row is managed in txAdmin and
                    carries no control.
                </p>

                {/* One citizen, and the way back to everyone. The chip is
                    the control: it states the filter and removes it, so
                    nobody can be looking at a narrowed list without seeing
                    that they are. */}
                {citizenid && (
                    <div className="banfilter">
                        <button
                            type="button"
                            className="chip chip--drop"
                            onClick={onClearCitizen}
                            /* The visible words plus what pressing it
                               does - the cross alone is a shape, not a
                               sentence, and it is hidden from the reader
                               that needs one. */
                            aria-label={`Only bans on ${citizenid} — show everyone again`}
                            title="Show the bans of everyone again"
                        >
                            <Icon name="id" size={14} />
                            <span>
                                {'Only bans on '}
                                <span className="u-mono">{citizenid}</span>
                            </span>
                            <Icon name="cross" size={13} className="chip__x" />
                        </button>
                        <span className="field__hint">{chipHint(identity)}</span>
                    </div>
                )}

                <div className="field">
                    <label className="field__label" htmlFor="allbans-search">Search</label>
                    <input
                        id="allbans-search"
                        className="input"
                        type="search"
                        autoComplete="off"
                        placeholder="Name, reason, issuer, citizen ID, action ID or identifier"
                        value={search}
                        onChange={(e) => change(setSearch)(e.target.value)}
                    />
                </div>

                <div className="panel__row">
                    <div className="field">
                        <span className="field__label" id="allbans-scope-label">Show</span>
                        <div className="segment" role="group" aria-labelledby="allbans-scope-label">
                            <button
                                type="button"
                                className="segment__btn"
                                aria-pressed={!activeOnly}
                                onClick={() => change(setActiveOnly)(false)}
                            >
                                Everything
                            </button>
                            <button
                                type="button"
                                className="segment__btn"
                                aria-pressed={activeOnly}
                                onClick={() => change(setActiveOnly)(true)}
                            >
                                In force only
                            </button>
                        </div>
                    </div>

                    <div className="field">
                        <span className="field__label" id="allbans-kind-label">Warnings</span>
                        <div className="segment" role="group" aria-labelledby="allbans-kind-label">
                            <button
                                type="button"
                                className="segment__btn"
                                aria-pressed={!includeWarnings}
                                onClick={() => change(setIncludeWarnings)(false)}
                            >
                                Bans only
                            </button>
                            <button
                                type="button"
                                className="segment__btn"
                                aria-pressed={includeWarnings}
                                onClick={() => change(setIncludeWarnings)(true)}
                            >
                                Include warnings
                            </button>
                        </div>
                        <span className="field__hint">
                            A warning is a note on record, not a ban — it keeps nobody out. Only
                            txAdmin records them.
                        </span>
                    </div>

                    <div className="field">
                        <span className="field__label" id="allbans-source-label">Record</span>
                        <div className="segment" role="group" aria-labelledby="allbans-source-label">
                            <button
                                type="button"
                                className="segment__btn"
                                aria-pressed={source === ''}
                                onClick={() => change(setSource)('')}
                            >
                                Both
                            </button>
                            <button
                                type="button"
                                className="segment__btn"
                                aria-pressed={source === 'database'}
                                onClick={() => change(setSource)('database')}
                            >
                                Database
                            </button>
                            <button
                                type="button"
                                className="segment__btn"
                                aria-pressed={source === 'txadmin'}
                                onClick={() => change(setSource)('txadmin')}
                            >
                                txAdmin
                            </button>
                        </div>
                    </div>
                </div>

                {res.status === 'error' && (
                    <StatusNote
                        tone="error"
                        title="The ban list could not be loaded"
                        detail={[res.error, res.hint].filter(Boolean).join(' ')}
                    />
                )}

                {/* Above the rows, always, and before anything is counted:
                    a record nobody could open is missing from the list
                    below, and the list below gives no sign of it. */}
                {databaseFailed && (
                    <SourceFailure
                        title="The database ban table could not be read"
                        missing="every ban this panel has ever issued"
                        rest={txadminAsked ? "What stands below is txAdmin's record alone." : null}
                        reason={sources.database?.reason}
                        hint={sources.database?.hint}
                    />
                )}

                {txadminFailed && (
                    <SourceFailure
                        title="The txAdmin ban record could not be read"
                        missing="every ban txAdmin is holding people out with"
                        rest={databaseAsked ? 'What stands below is the database table alone.' : null}
                        reason={sources.txadmin?.reason}
                        hint={sources.txadmin?.hint}
                    />
                )}

                {failedCount > 0 && (
                    <div className="acts">
                        <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            onClick={reload}
                            disabled={res.isStale}
                        >
                            Try both records again
                        </button>
                    </div>
                )}

                {/* Left out on purpose rather than lost. Said plainly all
                    the same, because a half list is a half list however it
                    came about. */}
                {ready && applied && (
                    <p className="field__hint">
                        {applied === 'database'
                            ? 'The record filter is set to the database table. txAdmin’s record is not being read, so anyone it holds is missing from this list.'
                            : 'The record filter is set to txAdmin. The database table is not being read, so anyone it holds is missing from this list.'}
                    </p>
                )}

                {unmatchable && (
                    <StatusNote
                        tone="info"
                        title="This citizen carries no license, Discord ID or IP on record"
                        detail="A ban is matched by exactly those, so filtering the list to this person can only ever come back empty. That is a fact about the character record, not about whether anyone is banned."
                    />
                )}

                {res.waiting && res.status === 'loading' && (
                    <p className="field__hint">Reading both ban records…</p>
                )}

                {ready && rows.length === 0 && !unmatchable && (
                    <p className="field__hint">
                        {emptyLine({
                            search, citizenid, activeOnly, includeWarnings, applied, failedCount,
                        })}
                    </p>
                )}

                {ready && rows.length > 0 && (
                    <>
                        <p className="field__hint">
                            {data.sort || 'In force first, then newest.'}
                        </p>
                        <ul className={`lines${res.isStale ? ' is-stale' : ''}`} aria-busy={res.isStale}>
                            {rows.map((entry) => (
                                <AllBansLine
                                    /* Unique across both records - the
                                       native ids are not. */
                                    key={entry.key}
                                    entry={entry}
                                    canEdit={canEdit}
                                    onFeedback={setFeedback}
                                    onChanged={reload}
                                />
                            ))}
                        </ul>
                    </>
                )}

                {feedback && (
                    <StatusNote tone={feedback.tone} title={feedback.title} detail={feedback.detail} />
                )}
            </div>

            {ready && pages > 1 && (
                <footer className="panel__foot">
                    <span className="panel__footinfo">{`Page ${page} of ${pages}`}</span>
                    <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() => goPage(page - 1)}
                        disabled={page <= 1 || res.isStale}
                    >
                        <Icon name="chevronLeft" size={15} />
                        Previous
                    </button>
                    <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() => goPage(page + 1)}
                        disabled={page >= pages || res.isStale}
                    >
                        Next
                        <Icon name="chevronRight" size={15} />
                    </button>
                </footer>
            )}
        </section>
    );
}

/**
 * One of the two records could not be opened.
 *
 * The sentence leads with what is missing rather than with the fault,
 * because the danger here is not the error - it is the list underneath it
 * reading as complete. The server's reason follows, since it is the only
 * party that knows it, and the operator's hint folds away.
 */
function SourceFailure({ title, missing, rest, reason, hint }) {
    const said = typeof reason === 'string' ? reason.trim() : '';
    const detail = [
        `This list is missing ${missing}. It is not an empty record — nobody managed to open it.`,
        rest,
        said ? `Reported: ${said}` : null,
    ].filter(Boolean).join(' ');

    return (
        <>
            <StatusNote tone="warn" title={title} detail={detail} />
            {typeof hint === 'string' && hint.trim() && (
                <details className="reveal">
                    <summary className="reveal__summary">Details for whoever runs this server</summary>
                    <p className="reveal__body field__hint">{hint.trim()}</p>
                </details>
            )}
        </>
    );
}

/**
 * How the one-citizen filter was matched.
 *
 * Neither record stores a citizenid, so "this person" is really "these
 * identifiers". Saying the number makes the filter checkable: a citizen
 * with one identifier and a citizen with four are not being asked the same
 * question. Zero is left to the notice below, which says what it means.
 */
function chipHint(identity) {
    const held = numberOrNull(identity?.identifiers);
    if (held === null || held < 1) return 'Clear the chip for every ban on the server.';
    return `Matched on the ${held === 1 ? 'one identifier' : `${held} identifiers`} this citizen carries. Clear the chip for every ban on the server.`;
}

/**
 * Read, and nothing came back. Each version says what was actually asked,
 * so an empty list is never mistaken for an empty record: a filter hiding
 * everything is a different statement from nobody being banned, and a
 * record nobody could open is a third thing again.
 */
function emptyLine({ search, citizenid, activeOnly, includeWarnings, applied, failedCount }) {
    if (failedCount > 0) {
        return 'Nothing matched in the record that could be read — and the other one could not be read at all. This is not the same as nobody being banned.';
    }

    const subject = includeWarnings ? 'ban or warning' : 'ban';
    const where = applied === 'database'
        ? ' in the database table'
        : applied === 'txadmin'
            ? ' in the txAdmin record'
            : '';

    if (search) {
        return `No ${subject}${where} matches “${search}”${citizenid ? ' for this citizen' : ''}${activeOnly ? ' and is in force' : ''}.`;
    }
    if (citizenid) {
        if (activeOnly) {
            return `No ${subject}${where} is in force against this citizen. Entries that are over are hidden by the filter.`;
        }
        return where
            ? `There is no ${subject}${where} against this citizen.`
            : `Neither record holds a ${subject} against this citizen.`;
    }
    if (activeOnly) {
        return `No ${subject}${where} is in force right now. Entries that are over are hidden by the filter.`;
    }
    return where
        ? `There is no ${subject}${where}.`
        : `Neither record holds a ${subject}.`;
}

function headHint(res, count, active, page, pages, failedCount) {
    if (res.waiting && res.status === 'loading') return 'Reading both ban records';
    if (res.status === 'error') return 'Ban list unknown';
    if (failedCount > 0 && count === 0) return 'A record could not be read';
    if (count === 0) return 'Nothing on record';

    const parts = [
        count === 1 ? '1 entry' : `${count} entries`,
        `${active} in force`,
    ];
    if (pages > 1) parts.push(`page ${page} of ${pages}`);
    if (failedCount > 0) parts.push('one record missing');

    return parts.join(' · ');
}
