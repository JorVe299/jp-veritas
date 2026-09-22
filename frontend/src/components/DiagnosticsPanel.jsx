import { useState } from 'react';
import Icon from './Icon';
import PermissionLine from './PermissionLine';
import StatusNote from './StatusNote';
import { fetchBridgeReport, fetchFramework, fetchSchema, refreshGameData } from '../api';
import { useCan } from '../lib/useCan';
import { useServerFetch } from '../lib/useServerData';
import { failureNote, successNote } from '../lib/writeFeedback';

/**
 * What this installation actually is.
 *
 * Almost every fault in this project has been a silent one: a bridge that
 * does not answer and a database belonging to some other game server look
 * exactly alike from the outside, and a wrong token shows up only as a 401
 * on an export, far away from its cause. This is the page that says which
 * of those it is.
 *
 * Every card hangs off system.view, including the framework probe, which
 * moved here when the resource browser was removed. The gate stays in
 * place so a card is only mounted when its own route would answer -
 * mounting it anyway would mean reporting a fault where none exists.
 */
export default function DiagnosticsPanel() {
    const { can } = useCan();
    const canSeeSystem = can('system.view');
    const canSeeFramework = canSeeSystem;

    return (
        <>
            {canSeeFramework && <FrameworkCard />}
            {canSeeSystem && <BridgeCard />}
            {canSeeSystem && <SchemaCard />}
            {canSeeSystem && <ReferenceDataCard canEdit={can('system.edit')} />}
        </>
    );
}

/* -------------------------------------------------------------------------
   What the bridge says it is running.
   ------------------------------------------------------------------------- */

function FrameworkCard() {
    const [token, setToken] = useState(0);
    const res = useServerFetch(fetchFramework, { token });

    const data = res.data || {};
    const adapters = data.adapters && typeof data.adapters === 'object' ? data.adapters : {};
    const adapterNames = Object.keys(adapters);

    // Only meaningful once an answer has actually arrived - before that,
    // "false" would be a claim rather than a reading.
    const tokenMismatch = res.status === 'ready' && data.tokenMatchLikely === false;

    return (
        <section className="panel" aria-labelledby="fw-panel-title">
            <header className="panel__head">
                <Icon name="pulse" size={18} className="panel__icon" />
                <div>
                    <h2 className="panel__title" id="fw-panel-title">Framework and inventory</h2>
                    <p className="panel__hint">{frameworkHint(res, data)}</p>
                </div>
            </header>

            <div className="panel__body">
                {res.status === 'unreachable' && (
                    <StatusNote
                        tone="warn"
                        title="The bridge did not answer"
                        detail={[res.error, res.hint].filter(Boolean).join(' ')}
                    />
                )}

                {res.status === 'error' && (
                    <StatusNote
                        tone="error"
                        title="The framework could not be read"
                        detail={[res.error, res.hint].filter(Boolean).join(' ')}
                    />
                )}

                {res.waiting && res.status === 'loading' && (
                    <p className="field__hint">Asking the bridge what it is attached to…</p>
                )}

                {res.status === 'ready' && (
                    <>
                        <dl className="kv">
                            <Row label="Framework" value={data.frameworkLabel || data.framework} />
                            <Row label="Inventory" value={data.inventory} />
                            <Row label="Identity key" value={data.identityKey} mono />
                            <Row
                                label="Token on the bridge"
                                value={yesNo(data.tokenConfigured, 'Configured', 'Not configured')}
                            />
                            <Row
                                label="Token in the backend"
                                value={yesNo(data.backendHasToken, 'Configured', 'Not configured')}
                            />
                        </dl>

                        {adapterNames.length > 0 && (
                            <div className="field">
                                <span className="field__label">Adapters the bridge found</span>
                                <div className="line__actions">
                                    {adapterNames.map((name) => (
                                        <span
                                            key={name}
                                            className={`pill${adapters[name] ? ' pill--live' : ' pill--off'}`}
                                        >
                                            {`${name} — ${adapters[name] ? 'present' : 'absent'}`}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* The single most useful line on this page. */}
                        {tokenMismatch && (
                            <StatusNote
                                tone="warn"
                                title="Backend and bridge disagree about the token"
                                detail="One end has a token configured and the other does not, so a call the bridge should accept will be rejected. This is the usual reason a resource export answers 401. Set BRIDGE_TOKEN in the backend and the same value as Config.Token in the veritas resource."
                            />
                        )}
                    </>
                )}
            </div>

            <footer className="panel__foot">
                <span className="panel__footinfo">Read live from the game server</span>
                <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => setToken((v) => v + 1)}
                    disabled={res.status === 'loading' && res.waiting}
                >
                    Ask again
                </button>
            </footer>
        </section>
    );
}

function frameworkHint(res, data) {
    if (res.waiting && res.status === 'loading') return 'Asking the bridge';
    if (res.status === 'unreachable') return 'Bridge unreachable';
    if (res.status === 'error') return 'Framework unknown';

    const fw = data.frameworkLabel || data.framework;
    return fw ? `Detected ${fw}` : 'The bridge named no framework';
}

/* -------------------------------------------------------------------------
   The link itself: does it answer, how fast, and does it agree with the
   database we are reading.
   ------------------------------------------------------------------------- */

function BridgeCard() {
    const [token, setToken] = useState(0);
    const res = useServerFetch(fetchBridgeReport, { token });

    const data = res.data || {};
    const ids = Array.isArray(data.citizenids) ? data.citizenids : [];
    const dbCheck = data.database && typeof data.database === 'object' ? data.database : null;

    return (
        <section className="panel" aria-labelledby="bridge-panel-title">
            <header className="panel__head">
                <Icon name="link" size={18} className="panel__icon" />
                <div>
                    <h2 className="panel__title" id="bridge-panel-title">The link</h2>
                    <p className="panel__hint">{bridgeHint(res, data)}</p>
                </div>
            </header>

            <div className="panel__body">
                {res.status === 'unreachable' && (
                    <StatusNote
                        tone="warn"
                        title="The game server did not answer"
                        detail={[res.error, res.hint].filter(Boolean).join(' ')}
                    />
                )}

                {res.status === 'error' && (
                    <StatusNote
                        tone="error"
                        title="The link could not be checked"
                        detail={[res.error, res.hint].filter(Boolean).join(' ')}
                    />
                )}

                {res.waiting && res.status === 'loading' && (
                    <p className="field__hint">Timing the link…</p>
                )}

                {res.status === 'ready' && (
                    <>
                        <dl className="kv">
                            <Row label="Answered in" value={msText(data.latencyMs)} />
                            <Row label="On the server now" value={countText(data.onlineCount)} />
                            <Row label="Address" value={data.url} mono />
                            <Row label="Answer shape" value={data.payloadShape} />
                        </dl>

                        {/* Where "really offline" parts ways with "wrong
                            database". Those two look identical on the wall. */}
                        {dbCheck && (dbCheck.ok === false ? (
                            <StatusNote
                                tone="warn"
                                title="The database does not match the game server"
                                detail={mismatchText(dbCheck)}
                            />
                        ) : (
                            <p className="field__hint">
                                {`The characters the game server reports are present in ${dbCheck.database || 'this database'} — panel and game server are looking at the same place.`}
                            </p>
                        ))}

                        {ids.length > 0 && (
                            <div className="field">
                                <span className="field__label">Citizen IDs the game server reports</span>
                                <p className="field__hint u-mono">{ids.join(', ')}</p>
                            </div>
                        )}

                        {ids.length === 0 && data.reachable && (
                            <p className="field__hint">
                                The link answers and reports nobody on the server. That is a
                                verified empty server, not an unknown one.
                            </p>
                        )}
                    </>
                )}
            </div>

            <footer className="panel__foot">
                <span className="panel__footinfo">Measured at the moment of asking</span>
                <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => setToken((v) => v + 1)}
                    disabled={res.status === 'loading' && res.waiting}
                >
                    Check again
                </button>
            </footer>
        </section>
    );
}

function bridgeHint(res, data) {
    if (res.waiting && res.status === 'loading') return 'Checking the link';
    if (res.status === 'unreachable') return 'No answer';
    if (res.status === 'error') return 'Link state unknown';

    // Each half only appears when it was actually measured.
    const parts = [
        msText(data.latencyMs) ? `Answered in ${msText(data.latencyMs)}` : null,
        countText(data.onlineCount) ? `${countText(data.onlineCount)} on the server` : null,
    ].filter(Boolean);

    return parts.length > 0 ? parts.join(' · ') : 'The link answered';
}

function mismatchText(check) {
    if (check.dbError) {
        return `The database could not be asked: ${check.dbError}`;
    }
    const parts = [
        'The game server reports characters that this database does not hold.',
        check.database ? `The panel is reading ${check.database}.` : null,
        'That usually means the backend points at a different database than the game server does.',
    ];
    return parts.filter(Boolean).join(' ');
}

/* -------------------------------------------------------------------------
   Does this schema carry what the modules need.
   ------------------------------------------------------------------------- */

function SchemaCard() {
    const [token, setToken] = useState(0);
    const res = useServerFetch(fetchSchema, { token });

    const data = res.data || {};
    const problems = Array.isArray(data.problems) ? data.problems : [];
    const tables = data.tables && typeof data.tables === 'object' ? data.tables : {};
    const tableNames = Object.keys(tables);
    const allTables = Array.isArray(data.allTables) ? data.allTables : [];

    return (
        <section className="panel" aria-labelledby="schema-panel-title">
            <header className="panel__head">
                <Icon name="box" size={18} className="panel__icon" />
                <div>
                    <h2 className="panel__title" id="schema-panel-title">Database schema</h2>
                    <p className="panel__hint">{schemaHint(res, data, problems.length)}</p>
                </div>
            </header>

            <div className="panel__body">
                {res.status === 'error' && (
                    <StatusNote
                        tone="error"
                        title="The schema could not be read"
                        detail={[res.error, res.hint].filter(Boolean).join(' ')}
                    />
                )}

                {res.waiting && res.status === 'loading' && (
                    <p className="field__hint">Reading the schema…</p>
                )}

                {res.status === 'ready' && (
                    <>
                        <dl className="kv">
                            <Row label="Database" value={data.database} mono />
                            <Row label="Tables in total" value={countText(allTables.length)} />
                        </dl>

                        {problems.length > 0 ? (
                            <StatusNote
                                tone="warn"
                                title={problems.length === 1
                                    ? 'One thing the modules need is missing'
                                    : `${problems.length} things the modules need are missing`}
                                detail={problems.join(' · ')}
                            />
                        ) : (
                            <p className="field__hint">
                                Every table and column the management modules rely on is present.
                            </p>
                        )}

                        {tableNames.length > 0 && (
                            <ul className="lines">
                                {tableNames.map((name) => {
                                    const entry = tables[name] || {};
                                    const missing = Array.isArray(entry.missingColumns)
                                        ? entry.missingColumns
                                        : [];
                                    const good = entry.exists && missing.length === 0;

                                    return (
                                        <li className="line" key={name}>
                                            <div className="line__top">
                                                <span className="line__name u-mono">{name}</span>
                                                <span className={`pill line__badge${good ? '' : ' pill--unknown'}`}>
                                                    {!entry.exists ? 'Missing' : good ? 'Complete' : 'Incomplete'}
                                                </span>
                                            </div>
                                            <div className="line__meta">
                                                {!entry.exists ? (
                                                    <span>This table does not exist in this database.</span>
                                                ) : missing.length > 0 ? (
                                                    <span>{`Missing columns: ${missing.join(', ')}`}</span>
                                                ) : (
                                                    <span>{`${(entry.columns || []).length} columns`}</span>
                                                )}
                                            </div>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}

                        {allTables.length > 0 && (
                            <details className="reveal">
                                <summary className="reveal__summary">
                                    {`All ${allTables.length} tables in this database`}
                                </summary>
                                <ul className="lines lines--scroll reveal__body">
                                    {allTables.map((entry) => (
                                        <li className="line" key={entry.name}>
                                            <div className="line__top">
                                                <span className="line__name u-mono">{entry.name}</span>
                                                <span className="line__slot">
                                                    {Number.isFinite(Number(entry.approxRows))
                                                        ? `about ${Number(entry.approxRows).toLocaleString('en-US')} rows`
                                                        : 'row count unknown'}
                                                </span>
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            </details>
                        )}
                    </>
                )}
            </div>

            <footer className="panel__foot">
                <span className="panel__footinfo">Read fresh, never from a cache</span>
                <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => setToken((v) => v + 1)}
                    disabled={res.status === 'loading' && res.waiting}
                >
                    Read again
                </button>
            </footer>
        </section>
    );
}

function schemaHint(res, data, problemCount) {
    if (res.waiting && res.status === 'loading') return 'Reading the schema';
    if (res.status === 'error') return 'Schema unknown';
    if (data.ok === true) return 'Everything the modules need is there';
    if (problemCount > 0) {
        return problemCount === 1 ? '1 thing missing' : `${problemCount} things missing`;
    }
    return 'Checked';
}

/* -------------------------------------------------------------------------
   Reloading the reference data. The only thing on this page that writes.
   ------------------------------------------------------------------------- */

function ReferenceDataCard({ canEdit }) {
    const [busy, setBusy] = useState(false);
    const [feedback, setFeedback] = useState(null);

    const run = async () => {
        if (!canEdit) return;

        setBusy(true);
        setFeedback(null);
        try {
            const answer = await refreshGameData();
            const loaded = answer.data?.loaded || {};
            // Only stated when the server actually counted - "null jobs"
            // would be worse than saying nothing about the sizes.
            const counted = ['jobs', 'items', 'vehicles']
                .map((kind) => (countText(loaded[kind]) ? `${countText(loaded[kind])} ${kind}` : null))
                .filter(Boolean);

            setFeedback(successNote(
                answer,
                'Reference data reloaded',
                counted.length > 0 ? `Now holding ${counted.join(', ')}.` : undefined,
            ));
        } catch (err) {
            setFeedback(failureNote('The reference data could not be reloaded', err));
        } finally {
            setBusy(false);
        }
    };

    return (
        <section className="panel" aria-labelledby="refdata-panel-title">
            <header className="panel__head">
                <Icon name="briefcase" size={18} className="panel__icon" />
                <div>
                    <h2 className="panel__title" id="refdata-panel-title">Reference data</h2>
                    <p className="panel__hint">Jobs, items and vehicles the panel reads from file</p>
                </div>
            </header>

            <div className="panel__body">
                {!canEdit && <PermissionLine what="reload the reference data" />}

                <p className="field__hint">
                    The job, item and vehicle lists are read once when the backend starts.
                    After editing those files on disk, this picks up the new version without
                    restarting the backend. Nothing in the game database is touched.
                </p>

                {feedback && (
                    <StatusNote tone={feedback.tone} title={feedback.title} detail={feedback.detail} />
                )}
            </div>

            <footer className="panel__foot">
                <span className="panel__footinfo">Affects the panel only</span>
                <button
                    type="button"
                    className="btn btn--ghost"
                    onClick={run}
                    disabled={!canEdit || busy}
                >
                    {busy ? 'Reloading…' : 'Reload reference data'}
                </button>
            </footer>
        </section>
    );
}

/* --- Small shared pieces -------------------------------------------------- */

/**
 * One line of a report. A value the server did not send is named as unknown
 * rather than left blank - a blank row reads like an empty setting.
 */
function Row({ label, value, mono = false }) {
    const known = value !== null && value !== undefined && value !== '';

    return (
        <div className="kv__row">
            <dt className="kv__key">{label}</dt>
            <dd className={`kv__value${mono && known ? ' u-mono' : ''}${known ? '' : ' kv__value--none'}`}>
                {known ? String(value) : 'not reported'}
            </dd>
        </div>
    );
}

function yesNo(value, yes, no) {
    if (value === true) return yes;
    if (value === false) return no;
    return null;
}

function msText(value) {
    const n = Number(value);
    return Number.isFinite(n) ? `${n} ms` : null;
}

function countText(value) {
    const n = Number(value);
    return Number.isFinite(n) ? String(n) : null;
}
