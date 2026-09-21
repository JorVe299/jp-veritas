import { useMemo, useState } from 'react';
import Icon from './Icon';
import PermissionLine from './PermissionLine';
import StatusNote from './StatusNote';
import { callResourceExport, fetchResources, readResourceFile } from '../api';
import { useCan } from '../lib/useCan';
import { useServerFetch } from '../lib/useServerData';

/**
 * The resources running on the game server.
 *
 * Three things happen on this page and they are deliberately not equally
 * dangerous:
 *
 *   listing  - reading which resources run. Harmless.
 *   reading  - pulling a file out of a resource. Changes nothing, but a
 *              config file can hold secrets.
 *   exporting - calling an export. Can do anything the target resource can
 *              do, which on a money or admin resource is everything.
 *
 * A single card with three buttons would flatten that into one gesture. So
 * they are three cards, stacked in that order, and the last one is marked
 * and explained rather than merely permission-checked.
 *
 * Both the reading and the exporting run against allow lists held on the
 * game server, not here. A refusal comes back as 409 with a hint naming the
 * exact config entry to add - that is an instruction, not a fault, and it is
 * shown as one.
 */
export default function ResourcesPanel() {
    const { can } = useCan();
    const canRead = can('resources.read');
    const canExec = can('resources.exec');

    const [token, setToken] = useState(0);
    const [filter, setFilter] = useState('');
    const [selected, setSelected] = useState('');

    const res = useServerFetch(fetchResources, { token });

    const data = res.data || {};
    const resources = useMemo(
        () => (Array.isArray(data.resources) ? data.resources : []),
        [data.resources],
    );

    // Filtered here rather than on the server: the route takes no search
    // parameter, and the list is short enough that a round trip per
    // keystroke would buy nothing.
    const shown = useMemo(() => {
        const needle = filter.trim().toLowerCase();
        if (!needle) return resources;
        return resources.filter((entry) => String(entry.name || '').toLowerCase().includes(needle));
    }, [resources, filter]);

    const count = Number(data.count ?? resources.length);

    return (
        <>
            {/* ---- 1. The list. Reading it changes nothing. ---- */}
            <section className="panel" aria-labelledby="res-panel-title">
                <header className="panel__head">
                    <Icon name="box" size={18} className="panel__icon" />
                    <div>
                        <h2 className="panel__title" id="res-panel-title">Resources</h2>
                        <p className="panel__hint">{headHint(res, count)}</p>
                    </div>
                </header>

                <div className="panel__body">
                    {res.status === 'unreachable' && (
                        <StatusNote
                            tone="warn"
                            title="The game server did not answer"
                            detail={[res.error, res.hint].filter(Boolean).join(' ')
                                || 'The resource list comes from the bridge inside the game server. Without it the panel still works from the database.'}
                        />
                    )}

                    {res.status === 'unavailable' && (
                        <StatusNote
                            tone="warn"
                            title="The resource list is not available here"
                            detail={[res.error, res.hint].filter(Boolean).join(' ')}
                        />
                    )}

                    {res.status === 'error' && (
                        <StatusNote
                            tone="error"
                            title="The resources could not be loaded"
                            detail={[res.error, res.hint].filter(Boolean).join(' ')}
                        />
                    )}

                    {res.waiting && res.status === 'loading' && (
                        <p className="field__hint">Asking the game server what it runs…</p>
                    )}

                    {res.status === 'ready' && resources.length === 0 && (
                        <p className="field__hint">
                            The game server answered, but named no resources at all.
                        </p>
                    )}

                    {resources.length > 0 && (
                        <>
                            <div className="field">
                                <label className="field__label" htmlFor="res-filter">Filter</label>
                                <input
                                    id="res-filter"
                                    className="input"
                                    type="search"
                                    autoComplete="off"
                                    placeholder="Resource name"
                                    value={filter}
                                    onChange={(e) => setFilter(e.target.value)}
                                />
                            </div>

                            {shown.length === 0 ? (
                                <p className="field__hint">{`No resource matches “${filter}”.`}</p>
                            ) : (
                                <ul className={`lines${shown.length > 6 ? ' lines--scroll' : ''}`}>
                                    {shown.map((entry) => (
                                        <li className="line" key={entry.name}>
                                            <div className="line__top">
                                                <span className="line__name u-mono">{entry.name}</span>
                                                {entry.name === selected && (
                                                    <span className="pill line__badge">Picked</span>
                                                )}
                                            </div>
                                            <div className="line__meta">
                                                <span>{entry.version ? `Version ${entry.version}` : 'No version declared'}</span>
                                                <span>{entry.author ? `By ${entry.author}` : 'No author declared'}</span>
                                            </div>
                                            <div className="line__actions">
                                                <button
                                                    type="button"
                                                    className="btn btn--ghost btn--sm"
                                                    onClick={() => setSelected(entry.name)}
                                                >
                                                    Use below
                                                </button>
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </>
                    )}
                </div>

                <footer className="panel__foot">
                    <span className="panel__footinfo">
                        {filter && resources.length > 0
                            ? `${shown.length} of ${resources.length} shown`
                            : 'Straight from the game server, not from the database'}
                    </span>
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

            {/* ---- 2. Reading a file. Looks, does not touch. ---- */}
            <ResourceFileCard key={`file-${selected}`} canRead={canRead} picked={selected} />

            {/* ---- 3. Calling an export. Set apart on purpose. ---- */}
            <ResourceExportCard key={`exp-${selected}`} canExec={canExec} picked={selected} />
        </>
    );
}

function headHint(res, count) {
    if (res.waiting && res.status === 'loading') return 'Asking the game server';
    if (res.status === 'unreachable') return 'Game server unreachable';
    if (res.status === 'unavailable') return 'Module unavailable';
    if (res.status === 'error') return 'Resources unknown';
    if (count === 0) return 'Nothing reported';
    return count === 1 ? '1 resource running' : `${count} resources running`;
}

/**
 * A refusal from the bridge arrives as 409 and carries a hint naming the
 * config line to add. That is an instruction, so it is neither dressed up as
 * an error nor swallowed. Everything else keeps its own shape: 502 means the
 * bridge is silent, and no response at all means the network is.
 */
function describeFailure(err, fallbackTitle) {
    const code = err?.response?.status;
    const body = err?.response?.data || {};

    if (code === 409) {
        return {
            tone: 'info',
            title: body.error || 'The game server refused this',
            detail: body.hint || 'The bridge keeps an allow list and this call is not on it.',
        };
    }

    if (code === 502) {
        return {
            tone: 'warn',
            title: body.error || 'The game server did not answer',
            detail: [body.hint, body.detail].filter(Boolean).join(' ')
                || 'The bridge inside the game server is not reachable from the backend.',
        };
    }

    return {
        tone: 'error',
        title: fallbackTitle,
        detail: [body.error || err?.message, body.hint].filter(Boolean).join(' '),
    };
}

/* -------------------------------------------------------------------------
   Reading a file out of a resource.

   Mounted even without the permission: nothing is requested until the button
   is pressed, so there is no 403 to run into, and a locked card with one
   sentence explains the level better than a card that is simply absent.
   ------------------------------------------------------------------------- */

function ResourceFileCard({ canRead, picked }) {
    const [resource, setResource] = useState(picked);
    const [file, setFile] = useState('');
    const [busy, setBusy] = useState(false);
    const [feedback, setFeedback] = useState(null);
    const [content, setContent] = useState(null);

    // Seeded from the pick in the list above by way of a key on this card,
    // so the field stays freely editable - and clearable - afterwards.
    const ready = Boolean(resource.trim() && file.trim()) && canRead && !busy;

    const submit = async (e) => {
        e.preventDefault();
        if (!ready) return;

        setBusy(true);
        setFeedback(null);
        setContent(null);
        try {
            const answer = await readResourceFile(resource.trim(), file.trim());
            const body = answer.data || {};
            setContent(typeof body.content === 'string' ? body.content : '');
            setFeedback({
                tone: 'success',
                title: `Read ${body.file || file} from ${body.resource || resource}`,
                detail: 'Nothing was changed — this is a copy of the file as the game server sees it.',
            });
        } catch (err) {
            setFeedback(describeFailure(err, 'The file could not be read'));
        } finally {
            setBusy(false);
        }
    };

    return (
        <section className="panel" aria-labelledby="resfile-panel-title">
            <header className="panel__head">
                <Icon name="id" size={18} className="panel__icon" />
                <div>
                    <h2 className="panel__title" id="resfile-panel-title">Read a file</h2>
                    <p className="panel__hint">Looks inside a resource and changes nothing</p>
                </div>
            </header>

            <form className="panel__form" onSubmit={submit}>
                <div className="panel__body">
                    {!canRead && <PermissionLine what="read files out of a resource" />}

                    <p className="field__hint">
                        The game server keeps an allow list of readable files. A file that is
                        not on it comes back refused, with the line to add named in the answer.
                    </p>

                    <div className="panel__row">
                        <div className="field">
                            <label className="field__label" htmlFor="resfile-res">Resource</label>
                            <input
                                id="resfile-res"
                                className="input u-mono"
                                type="text"
                                autoComplete="off"
                                placeholder="Resource name"
                                value={resource}
                                onChange={(e) => { setResource(e.target.value); setFeedback(null); }}
                                disabled={!canRead || busy}
                            />
                        </div>

                        <div className="field">
                            <label className="field__label" htmlFor="resfile-file">File</label>
                            <input
                                id="resfile-file"
                                className="input u-mono"
                                type="text"
                                autoComplete="off"
                                placeholder="config.lua"
                                value={file}
                                onChange={(e) => { setFile(e.target.value); setFeedback(null); }}
                                disabled={!canRead || busy}
                            />
                        </div>
                    </div>

                    {feedback && (
                        <StatusNote tone={feedback.tone} title={feedback.title} detail={feedback.detail} />
                    )}

                    {content !== null && (
                        content === ''
                            ? <p className="field__hint">The file is there and it is empty.</p>
                            : <pre className="code u-mono">{content}</pre>
                    )}
                </div>

                <footer className="panel__foot">
                    <span className="panel__footinfo">Reading only</span>
                    <button type="submit" className="btn btn--ghost" disabled={!ready}>
                        {busy ? 'Reading…' : 'Read file'}
                    </button>
                </footer>
            </form>
        </section>
    );
}

/* -------------------------------------------------------------------------
   Calling an export.

   The one place in the whole panel where the surface cannot say what will
   happen. An export runs inside the target resource, and the panel has no
   idea whether the method it is handed reads a number or empties a bank. So
   this card is marked, says that plainly, and takes two presses.
   ------------------------------------------------------------------------- */

function ResourceExportCard({ canExec, picked }) {
    const [resource, setResource] = useState(picked);
    const [method, setMethod] = useState('');
    const [args, setArgs] = useState('');
    const [confirming, setConfirming] = useState(false);
    const [busy, setBusy] = useState(false);
    const [feedback, setFeedback] = useState(null);
    const [result, setResult] = useState(null);

    const parsed = parseArgs(args);
    const ready = Boolean(resource.trim() && method.trim()) && parsed.ok && canExec && !busy;

    const change = (setter) => (value) => {
        setter(value);
        setConfirming(false);
        setFeedback(null);
    };

    const submit = async (e) => {
        e.preventDefault();
        if (!ready) return;

        // The first press only asks. Only the second one calls.
        if (!confirming) {
            setConfirming(true);
            setFeedback(null);
            return;
        }

        setBusy(true);
        setFeedback(null);
        setResult(null);
        try {
            const answer = await callResourceExport(resource.trim(), method.trim(), parsed.value);
            const body = answer.data || {};
            setResult(body.result);
            setFeedback({
                tone: 'success',
                title: `${body.resource || resource}:${body.method || method} returned`,
                detail: body.result === undefined || body.result === null
                    ? 'The export ran and gave nothing back. Whether it changed anything is not visible from here.'
                    : undefined,
            });
            setConfirming(false);
        } catch (err) {
            setConfirming(false);
            setFeedback(describeFailure(err, 'The export could not be called'));
        } finally {
            setBusy(false);
        }
    };

    return (
        <section className="panel panel--armed" aria-labelledby="resexp-panel-title">
            <header className="panel__head">
                <Icon name="bolt" size={18} className="panel__icon" />
                <div>
                    <h2 className="panel__title" id="resexp-panel-title">Call an export</h2>
                    <p className="panel__hint">Runs code inside another resource</p>
                </div>
            </header>

            <form className="panel__form" onSubmit={submit}>
                <div className="panel__body">
                    {!canExec && <PermissionLine what="call exports on a resource" />}

                    <StatusNote
                        tone="warn"
                        title="This one is not like the two above"
                        detail="An export runs inside the target resource and can do everything that resource can do. The panel cannot tell a harmless lookup from one that moves money or bans somebody — it only passes the call on."
                    />

                    <p className="field__hint">
                        The game server keeps an allow list of callable exports, and the call
                        also needs a shared token between backend and bridge. Either one
                        missing comes back refused, naming what to put right.
                    </p>

                    <div className="panel__row">
                        <div className="field">
                            <label className="field__label" htmlFor="resexp-res">Resource</label>
                            <input
                                id="resexp-res"
                                className="input u-mono"
                                type="text"
                                autoComplete="off"
                                placeholder="Resource name"
                                value={resource}
                                onChange={(e) => change(setResource)(e.target.value)}
                                disabled={!canExec || busy}
                            />
                        </div>

                        <div className="field">
                            <label className="field__label" htmlFor="resexp-method">Export</label>
                            <input
                                id="resexp-method"
                                className="input u-mono"
                                type="text"
                                autoComplete="off"
                                placeholder="GetAccountBalance"
                                value={method}
                                onChange={(e) => change(setMethod)(e.target.value)}
                                disabled={!canExec || busy}
                            />
                        </div>
                    </div>

                    <div className="field">
                        <label className="field__label" htmlFor="resexp-args">Arguments</label>
                        <input
                            id="resexp-args"
                            className="input u-mono"
                            type="text"
                            autoComplete="off"
                            placeholder='["police", 500]'
                            value={args}
                            onChange={(e) => change(setArgs)(e.target.value)}
                            disabled={!canExec || busy}
                        />
                        <span className="field__hint">
                            {args.trim() === ''
                                ? 'A JSON array, or leave it empty to call with no arguments.'
                                : parsed.ok
                                    ? `${parsed.value.length} argument${parsed.value.length === 1 ? '' : 's'} will be passed.`
                                    : parsed.reason}
                        </span>
                    </div>

                    {confirming && (
                        <p className="field__hint">
                            {`This calls ${resource.trim()}:${method.trim()} on the running game server. It cannot be undone from here.`}
                        </p>
                    )}

                    {feedback && (
                        <StatusNote tone={feedback.tone} title={feedback.title} detail={feedback.detail} />
                    )}

                    {result !== undefined && result !== null && (
                        <pre className="code u-mono">{stringify(result)}</pre>
                    )}
                </div>

                <footer className="panel__foot">
                    <span className="panel__footinfo">
                        {confirming ? 'Press again to call it' : 'Two presses — the second one calls'}
                    </span>

                    {confirming ? (
                        <>
                            <button type="submit" className="btn btn--danger" disabled={!ready}>
                                {busy ? 'Calling…' : 'Really call it'}
                            </button>
                            <button
                                type="button"
                                className="btn btn--ghost"
                                onClick={() => setConfirming(false)}
                                disabled={busy}
                            >
                                Cancel
                            </button>
                        </>
                    ) : (
                        <button type="submit" className="btn btn--ghost" disabled={!ready}>
                            Call export
                        </button>
                    )}
                </footer>
            </form>
        </section>
    );
}

/**
 * Arguments are typed as JSON, because an export takes numbers, strings and
 * objects and a comma-separated line could not tell 5 from "5". A bad value
 * is caught here rather than being sent for the server to reject.
 */
function parseArgs(raw) {
    const text = raw.trim();
    if (text === '') return { ok: true, value: [] };

    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch {
        return {
            ok: false,
            value: [],
            reason: 'That is not valid JSON. Write the arguments as an array, for example ["police", 500].',
        };
    }

    if (!Array.isArray(parsed)) {
        return {
            ok: false,
            value: [],
            reason: 'The arguments have to be an array, for example ["police", 500].',
        };
    }

    return { ok: true, value: parsed };
}

/** Whatever the export gave back, made readable without claiming a shape. */
function stringify(value) {
    if (typeof value === 'string') return value;
    try {
        return JSON.stringify(value, null, 2);
    } catch {
        return String(value);
    }
}
