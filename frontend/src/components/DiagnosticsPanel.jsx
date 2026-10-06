import { useState } from 'react';
import CooldownLabel from './CooldownLabel';
import Icon from './Icon';
import PermissionLine from './PermissionLine';
import StatusNote from './StatusNote';
import { fetchBridgeReport, fetchFramework, fetchSchema, refreshGameData } from '../api';
import { useCan } from '../lib/useCan';
import { useCooldown } from '../lib/useCooldown';
import { useServerFetch } from '../lib/useServerData';
import { failureNote, successNote } from '../lib/writeFeedback';

/**
 * Diagnostics for look-alike silent faults: dead bridge, wrong database, token mismatch
 * Cards mount only with system.view: otherwise their routes' refusals would read as faults
 */
export default function DiagnosticsPanel() {
    const { can } = useCan();
    const canSeeSystem = can('system.view');

    return (
        <>
            {canSeeSystem && <FrameworkCard />}
            {canSeeSystem && <BridgeCard />}
            {canSeeSystem && <SchemaCard />}
            {canSeeSystem && <ReferenceDataCard canEdit={can('system.edit')} />}
        </>
    );
}

// --- Framework ------------------------------------------------------------

// One cooldown key per card: each asks the bridge or database something different
function useAskAgain(key) {
    const [token, setToken] = useState(0);
    const cooldown = useCooldown(key);

    const again = () => {
        cooldown.start();
        setToken((v) => v + 1);
    };

    return { token, again, remaining: cooldown.remaining };
}

function FrameworkCard() {
    const ask = useAskAgain('diagnostics-framework');
    const res = useServerFetch(fetchFramework, { token: ask.token });

    const data = res.data || {};
    const adapters = data.adapters && typeof data.adapters === 'object' ? data.adapters : {};
    const adapterNames = Object.keys(adapters);

    // Only once an answer arrived: before that, false would be a claim, not a reading
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
                                            className={`pill pill--fit${adapters[name] ? ' pill--live' : ' pill--off'}`}
                                            title={`${name} — ${adapters[name] ? 'present' : 'absent'}`}
                                        >
                                            <span className="u-clip">
                                                {`${name} — ${adapters[name] ? 'present' : 'absent'}`}
                                            </span>
                                        </span>
                                    ))}
                                </div>
                            </div>
                        )}

                        {tokenMismatch && (
                            <StatusNote
                                tone="warn"
                                title="Backend and bridge disagree about the token"
                                detail="Set BRIDGE_TOKEN in the backend and the same value as Config.Token in the bridge."
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
                    onClick={ask.again}
                    disabled={(res.status === 'loading' && res.waiting) || ask.remaining > 0}
                >
                    <CooldownLabel text="Ask again" remaining={ask.remaining} />
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

// --- Bridge link ----------------------------------------------------------

function BridgeCard() {
    const ask = useAskAgain('diagnostics-bridge');
    const res = useServerFetch(fetchBridgeReport, { token: ask.token });

    const data = res.data || {};
    const ids = Array.isArray(data.citizenids) ? data.citizenids : [];
    const dbCheck = data.database && typeof data.database === 'object' ? data.database : null;

    return (
        <section className="panel" aria-labelledby="bridge-panel-title">
            <header className="panel__head">
                <Icon name="link" size={18} className="panel__icon" />
                <div>
                    <h2 className="panel__title" id="bridge-panel-title">The link</h2>
                    <p className="panel__hint">{bridgeHint(res)}</p>
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

                {res.status === 'ready' && (
                    <>
                        <dl className="kv">
                            <Row label="Answered in" value={msText(data.latencyMs)} />
                            <Row label="On the server now" value={countText(data.onlineCount)} />
                            <Row label="Address" value={data.url} mono />
                            <Row label="Answer shape" value={data.payloadShape} />
                        </dl>

                        {/* Offline vs wrong database: identical on the wall */}
                        {dbCheck && (dbCheck.ok === false ? (
                            <StatusNote
                                tone="warn"
                                title="The database does not match the game server"
                                detail={mismatchText(dbCheck)}
                            />
                        ) : (
                            <p className="field__hint">
                                {`Same database as the game server (${dbCheck.database || 'this database'}).`}
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
                                Nobody on the server.
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
                    onClick={ask.again}
                    disabled={(res.status === 'loading' && res.waiting) || ask.remaining > 0}
                >
                    <CooldownLabel text="Check again" remaining={ask.remaining} />
                </button>
            </footer>
        </section>
    );
}

// Latency and count stay in the rows below: not repeated here
function bridgeHint(res) {
    if (res.waiting && res.status === 'loading') return 'Checking the link';
    if (res.status === 'unreachable') return 'No answer';
    if (res.status === 'error') return 'Link state unknown';
    return 'Link answered';
}

function mismatchText(check) {
    if (check.dbError) {
        return `The database could not be asked: ${check.dbError}`;
    }
    const parts = [
        'Online characters are missing here.',
        check.database ? `The panel reads ${check.database}; the game server likely another.` : null,
    ];
    return parts.filter(Boolean).join(' ');
}

// --- Schema ---------------------------------------------------------------

function SchemaCard() {
    const ask = useAskAgain('diagnostics-schema');
    const res = useServerFetch(fetchSchema, { token: ask.token });

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

                {res.status === 'ready' && (
                    <>
                        <dl className="kv">
                            <Row label="Database" value={data.database} mono />
                            <Row label="Tables in total" value={countText(allTables.length)} />
                        </dl>

                        {problems.length > 0 && (
                            <StatusNote
                                tone="warn"
                                title={problems.length === 1
                                    ? 'One thing the modules need is missing'
                                    : `${problems.length} things the modules need are missing`}
                                detail={problems.join(' · ')}
                            />
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
                    onClick={ask.again}
                    disabled={(res.status === 'loading' && res.waiting) || ask.remaining > 0}
                >
                    <CooldownLabel text="Read again" remaining={ask.remaining} />
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

// --- Reference data -------------------------------------------------------

function ReferenceDataCard({ canEdit }) {
    const [busy, setBusy] = useState(false);
    const [feedback, setFeedback] = useState(null);
    const cooldown = useCooldown('diagnostics-refdata');

    const run = async () => {
        if (!canEdit || !cooldown.ready) return;

        // Every press counts, as on the server, not only successful ones
        cooldown.start();
        setBusy(true);
        setFeedback(null);
        try {
            const answer = await refreshGameData();
            const loaded = answer.data?.loaded || {};
            // Only counts the server sent: never "null jobs"
            const counted = ['jobs', 'items', 'vehicles']
                .map((kind) => (countText(loaded[kind]) ? `${countText(loaded[kind])} ${kind}` : null))
                .filter(Boolean);

            setFeedback(successNote(
                answer,
                'Reference data reloaded',
                counted.length > 0 ? `Now holding ${counted.join(', ')}.` : undefined,
            ));
        } catch (err) {
            if (err.response?.status === 429) {
                // Rate limit (once a minute per user), not a fault; the server's clock wins:
                // a page reload forgets the last press, the server does not
                const wait = retryAfterSeconds(err.response);
                if (wait !== null) cooldown.start(wait * 1000);
                setFeedback({
                    tone: 'warn',
                    title: 'Reloaded only a moment ago',
                    detail: err.response.data?.error
                        || 'The reference data can be reloaded once a minute.',
                });
            } else {
                setFeedback(failureNote('The reference data could not be reloaded', err));
            }
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

                <p className="field__hint">Re-reads the files without a backend restart.</p>

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
                    disabled={!canEdit || busy || !cooldown.ready}
                >
                    {busy
                        ? 'Reloading…'
                        : <CooldownLabel text="Reload reference data" remaining={cooldown.remaining} />}
                </button>
            </footer>
        </section>
    );
}

function retryAfterSeconds(response) {
    const candidates = [response?.data?.retryAfter, response?.headers?.['retry-after']];
    for (const value of candidates) {
        const seconds = Number(value);
        if (value !== null && value !== undefined && value !== '' && Number.isFinite(seconds) && seconds >= 0) {
            return Math.ceil(seconds);
        }
    }
    return null;
}

// --- Shared pieces --------------------------------------------------------

// Never blank for a missing value: a blank row reads like an empty setting
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
