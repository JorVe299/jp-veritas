import { useState } from 'react';
import AllBansLine from './AllBansLine';
import CooldownLabel from './CooldownLabel';
import Icon from './Icon';
import PermissionLine from './PermissionLine';
import StatusNote from './StatusNote';
import { numberOrNull } from '../lib/portalText';
import { useAllBans } from '../lib/useAllBans';
import { useCan } from '../lib/useCan';
import { useCooldown } from '../lib/useCooldown';

const LIMIT = 50;

/**
 * Bans from both records (database table + txAdmin), merged and sorted together
 * An unreadable source is not an absence of bans (route answers 200, flagged per source)
 * Server's order, in force first; no sort control: any other order buries who is out now
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

    // Page carries its filter key instead of a reset effect: a filter change means page 1
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
    // From the answer, not the control: describe the list shown, not the request in flight
    const applied = data.filter?.source || null;
    const databaseAsked = applied !== 'txadmin';
    const txadminAsked = applied !== 'database';

    // available:false counts only for an asked source; the filter leaves the other out
    const databaseFailed = ready && databaseAsked && sources.database?.available === false;
    const txadminFailed = ready && txadminAsked && sources.txadmin?.available === false;
    const failedCount = (databaseFailed ? 1 : 0) + (txadminFailed ? 1 : 0);

    const count = numberOrNull(data.count) ?? 0;
    const activeCount = numberOrNull(data.activeCount) ?? 0;
    const pages = Math.max(numberOrNull(data.pages) ?? 1, 1);

    const identity = data.identity || null;
    // A citizen without identifiers can match no ban: an empty list would say nothing
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

    // Cooldown binds only the button: a line's change reloads directly
    const retryCooldown = useCooldown('allbans-retry');
    const retryByHand = () => {
        retryCooldown.start();
        reload();
    };

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
                    Database and txAdmin bans. Only database bans can be lifted here.
                </p>

                {/* Pill states and clears the filter: a narrowed list never goes unmarked */}
                {citizenid && (
                    <div className="banfilter">
                        <button
                            type="button"
                            className="pill pill--lg pill--drop"
                            onClick={onClearCitizen}
                            /* Words plus action: the cross says nothing to a screen reader */
                            aria-label={`Only bans on ${citizenid} — show everyone again`}
                            title="Show the bans of everyone again"
                        >
                            <Icon name="id" size={14} />
                            <span>
                                {'Only bans on '}
                                <span className="u-mono">{citizenid}</span>
                            </span>
                            <Icon name="cross" size={13} className="pill__x" />
                        </button>
                        {filterHint(identity) && (
                            <span className="field__hint">{filterHint(identity)}</span>
                        )}
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
                        <span className="field__hint">Notes, not bans; txAdmin only.</span>
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

                {/* Above the rows: the list itself gives no sign a record is missing */}
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
                            onClick={retryByHand}
                            disabled={res.isStale || !retryCooldown.ready}
                        >
                            <CooldownLabel text="Try both records again" remaining={retryCooldown.remaining} />
                        </button>
                    </div>
                )}

                {unmatchable && (
                    <StatusNote
                        tone="info"
                        title="This citizen carries no license, Discord ID or IP on record"
                        detail="Bans match on those, so this filter stays empty."
                    />
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
                                    /* Unique across both records; native ids are not */
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

// What is missing comes first: the danger is the list below reading as complete
function SourceFailure({ title, missing, rest, reason, hint }) {
    const said = typeof reason === 'string' ? reason.trim() : '';
    const detail = [
        `Missing below: ${missing}.`,
        rest,
        said ? `Reported: ${said}` : null,
    ].filter(Boolean).join(' ');

    return (
        <>
            <StatusNote tone="warn" title={title} detail={detail} />
            {typeof hint === 'string' && hint.trim() && (
                <details className="reveal">
                    <summary className="reveal__summary">Technical details</summary>
                    <p className="reveal__body field__hint">{hint.trim()}</p>
                </details>
            )}
        </>
    );
}

// Bans match identifiers, not citizenids: naming the count makes the filter checkable;
// zero is left to the unmatchable notice
function filterHint(identity) {
    const held = numberOrNull(identity?.identifiers);
    if (held === null || held < 1) return null;
    return `Matched on ${held === 1 ? '1 identifier' : `${held} identifiers`}`;
}

// Never reads as an empty record: filtered-out, no bans and unreadable are distinct claims
function emptyLine({ search, citizenid, activeOnly, includeWarnings, applied, failedCount }) {
    if (failedCount > 0) {
        return 'No match in the readable record; the other could not be read.';
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
            return `No ${subject}${where} is in force against this citizen.`;
        }
        return where
            ? `There is no ${subject}${where} against this citizen.`
            : `Neither record holds a ${subject} against this citizen.`;
    }
    if (activeOnly) {
        return `No ${subject}${where} is in force right now.`;
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
