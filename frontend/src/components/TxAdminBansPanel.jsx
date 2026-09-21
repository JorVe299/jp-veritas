import { useState } from 'react';
import Icon from './Icon';
import StatusNote from './StatusNote';
import TxAdminBanLine from './TxAdminBanLine';
import { numberOrNull } from '../lib/portalText';
import { useTxAdminBans } from '../lib/useTxAdminBans';

/**
 * The other ban record: the one txAdmin keeps.
 *
 * A server bans in two places that know nothing about each other. The
 * database table above is what the framework and this panel write, and it
 * is the only one anything here can lift. This is the second: a file beside
 * the server that txAdmin owns, which this panel can read and nothing more.
 * Until it stood here the gap was not merely missing, it was invisible - an
 * empty table reads as "nobody is banned" even while txAdmin is turning
 * people away at the door.
 *
 * Two things the surface has to keep true, and everything below is shaped
 * by them:
 *
 *   Nobody may mistake this list for the other one. Hence a panel of its
 *   own, named for its source, saying where that source lives - and not one
 *   control on any row. An admin who read a txAdmin ban as ours and went
 *   hunting for the unban button would be worse served than by not seeing
 *   it at all.
 *
 *   available: false means the record could not be read, never "no bans".
 *   The route answers that with 200, so it is not a failed request; it is
 *   still the opposite of an empty list, and it is never drawn as one.
 */
export default function TxAdminBansPanel() {
    const [search, setSearch] = useState('');
    const [activeOnly, setActiveOnly] = useState(false);
    const [includeWarnings, setIncludeWarnings] = useState(false);
    const [token, setToken] = useState(0);

    const res = useTxAdminBans({ search, activeOnly, includeWarnings, token });

    const data = res.data || {};
    // Only an explicit false means nobody could look. A missing field is
    // not a denial and must not be read as one.
    const unreadable = res.status === 'ready' && data.available === false;
    const readable = res.status === 'ready' && !unreadable;

    const rows = Array.isArray(data.bans) ? data.bans : [];
    const warnings = rows.filter(isWarning);
    const bans = rows.filter((row) => !isWarning(row));
    const standing = bans.filter(inForce);
    const over = bans.filter((row) => !inForce(row));

    // The server counts the whole match; the list is only the part of it
    // that fits under the limit. Both numbers are said out loud where they
    // differ, because a list that quietly stops short of the record is the
    // same kind of failure as a record nobody read.
    const matched = numberOrNull(data.count);
    const truncated = data.truncated === true && matched !== null && matched > rows.length;
    const source = typeof data.source === 'string' && data.source.trim() ? data.source.trim() : null;

    const reload = () => setToken((v) => v + 1);

    return (
        <section className="panel" aria-labelledby="txbans-panel-title">
            <header className="panel__head">
                <Icon name="server" size={18} className="panel__icon" />
                <div>
                    <h2 className="panel__title" id="txbans-panel-title">Bans in txAdmin</h2>
                    <p className="panel__hint">
                        {headHint(res, unreadable, rows.length, standing.length, matched)}
                    </p>
                </div>
            </header>

            <div className="panel__body">
                {/* Said once, and quietly: where this record lives, and that
                    this panel is only a reader of it. */}
                <p className="field__hint">
                    These entries come from txAdmin&rsquo;s own record — a file beside the server,
                    not the <strong>bans</strong> table above. They are shown here and managed in
                    txAdmin: nothing in this panel can lift, shorten or delete one.
                </p>

                <div className="field">
                    <label className="field__label" htmlFor="txbans-search">Search</label>
                    <input
                        id="txbans-search"
                        className="input"
                        type="search"
                        autoComplete="off"
                        placeholder="Name, reason, action ID or identifier"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                </div>

                <div className="panel__row">
                    <div className="field">
                        <span className="field__label" id="txbans-scope-label">Show</span>
                        <div className="segment" role="group" aria-labelledby="txbans-scope-label">
                            <button
                                type="button"
                                className="segment__btn"
                                aria-pressed={!activeOnly}
                                onClick={() => setActiveOnly(false)}
                            >
                                Everything
                            </button>
                            <button
                                type="button"
                                className="segment__btn"
                                aria-pressed={activeOnly}
                                onClick={() => setActiveOnly(true)}
                            >
                                In force only
                            </button>
                        </div>
                    </div>

                    <div className="field">
                        <span className="field__label" id="txbans-kind-label">Warnings</span>
                        <div className="segment" role="group" aria-labelledby="txbans-kind-label">
                            <button
                                type="button"
                                className="segment__btn"
                                aria-pressed={!includeWarnings}
                                onClick={() => setIncludeWarnings(false)}
                            >
                                Bans only
                            </button>
                            <button
                                type="button"
                                className="segment__btn"
                                aria-pressed={includeWarnings}
                                onClick={() => setIncludeWarnings(true)}
                            >
                                Include warnings
                            </button>
                        </div>
                        <span className="field__hint">
                            A warning is a note on record, not a ban — it keeps nobody out.
                        </span>
                    </div>
                </div>

                {res.status === 'error' && (
                    <StatusNote
                        tone="error"
                        title="The txAdmin ban record could not be loaded"
                        detail={[res.error, res.hint].filter(Boolean).join(' ')}
                    />
                )}

                {unreadable && <Unreadable data={data} onRetry={reload} />}

                {res.waiting && res.status === 'loading' && (
                    <p className="field__hint">Reading the txAdmin ban record…</p>
                )}

                {readable && rows.length === 0 && (
                    <p className="field__hint">{emptyLine(search, activeOnly, includeWarnings)}</p>
                )}

                {readable && truncated && (
                    <p className="field__hint">
                        {`Showing the newest ${rows.length} of ${matched} matching entries. Narrow the search to reach the rest.`}
                    </p>
                )}

                {/* Gated on 'readable', not only on having rows. An
                    unreadable record ships an empty list today, so the two
                    cannot collide - but that is the backend's promise, and
                    the one thing this panel must never do is draw a list
                    when nobody managed to open the record. Better the
                    guarantee lives here. */}
                {readable && rows.length > 0 && (
                    <div aria-busy={res.isStale}>
                        {/* In force first, over afterwards, warnings last, and
                            each group in the order the server sent it - newest
                            first. The grouping carries the weight: what applies
                            today never sits mixed in among what does not. */}
                        <BanGroup
                            title="In force"
                            hint="Kept out of the server right now."
                            entries={standing}
                            stale={res.isStale}
                        />
                        <BanGroup
                            title="No longer in force"
                            hint="Lifted in txAdmin or run out. On record, blocking nobody."
                            entries={over}
                            stale={res.isStale}
                        />
                        <BanGroup
                            title="Warnings"
                            hint="Notes on record. A warning has never kept anyone out."
                            entries={warnings}
                            stale={res.isStale}
                        />
                    </div>
                )}
            </div>

            {source && (
                <footer className="panel__foot">
                    <span className="panel__footinfo">
                        Read from <span className="u-mono txbans__path">{source}</span>
                    </span>
                    <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={reload}
                        disabled={res.isStale}
                    >
                        Read again
                    </button>
                </footer>
            )}
        </section>
    );
}

function isWarning(entry) {
    return entry?.type === 'warn';
}

/** Whether an entry is in force. Read from the server's field, not recomputed. */
function inForce(entry) {
    return entry?.active === true;
}

function BanGroup({ title, hint, entries, stale }) {
    if (entries.length === 0) return null;

    return (
        <div className="bangroup">
            <h3 className="bangroup__title u-caps">{`${title} · ${entries.length}`}</h3>
            <p className="bangroup__hint">{hint}</p>
            {/* While a new query runs the old list stays put but is held
                back - the same gesture the database list makes. */}
            <ul className={`lines${stale ? ' is-stale' : ''}`}>
                {entries.map((entry, index) => (
                    /* The txAdmin action id is the natural key, but it can be
                       null and two rows could share that; the index keeps the
                       list stable either way. */
                    <TxAdminBanLine key={`${entry?.id ?? 'entry'}-${index}`} entry={entry} />
                ))}
            </ul>
        </div>
    );
}

/**
 * Nobody could look.
 *
 * The server's reason is the sentence, because it is the only party that
 * knows why. The hint is written for whoever runs the server, so it folds
 * away - in this panel that is usually the same person, which is why it is
 * folded rather than dropped.
 */
function Unreadable({ data, onRetry }) {
    const reason = typeof data?.reason === 'string' ? data.reason.trim() : '';
    const hint = typeof data?.hint === 'string' ? data.hint.trim() : '';

    return (
        <>
            <StatusNote
                tone="warn"
                title="The txAdmin ban record could not be read"
                detail={
                    reason
                        ? `This is not an empty record: nobody managed to open it, so this panel cannot say who txAdmin is holding. Reported: ${reason}`
                        : 'This is not an empty record: nobody managed to open it, so this panel cannot say who txAdmin is holding, and the server did not say why.'
                }
            />

            {hint && (
                <details className="reveal">
                    <summary className="reveal__summary">Details for whoever runs this server</summary>
                    <p className="reveal__body field__hint">{hint}</p>
                </details>
            )}

            <div className="acts">
                <button type="button" className="btn btn--ghost btn--sm" onClick={onRetry}>
                    Try again
                </button>
            </div>
        </>
    );
}

/**
 * Read, and nothing came back. Each version says what was actually asked,
 * so that an empty list is never mistaken for an empty record: a filter
 * hiding everything is a different statement from a record holding nothing.
 */
function emptyLine(search, activeOnly, includeWarnings) {
    const subject = includeWarnings ? 'ban or warning' : 'ban';

    if (search) {
        return `No ${subject} in the txAdmin record matches “${search}”${activeOnly ? ' and is in force' : ''}.`;
    }
    if (activeOnly) {
        return `No ${subject} in the txAdmin record is in force right now. Entries that are over are hidden by the filter.`;
    }
    return `The txAdmin record holds no ${includeWarnings ? 'bans and no warnings' : 'bans'}.`;
}

function headHint(res, unreadable, shown, standing, matched) {
    if (res.waiting && res.status === 'loading') return 'Reading the txAdmin record';
    if (res.status === 'error') return 'txAdmin record unknown';
    if (unreadable) return 'Record unreadable';
    if (shown === 0) return 'Nothing on record';

    // With the match cut off by the limit, the number in force is only the
    // number among the rows that arrived - so it is not stated as though it
    // were the record's. The groups below count what is on screen.
    if (matched !== null && matched > shown) return `${shown} of ${matched} shown · read-only`;

    return `${shown} on record · ${standing} in force · read-only`;
}
