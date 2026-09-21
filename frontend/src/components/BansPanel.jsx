import { useState } from 'react';
import BanLine from './BanLine';
import Icon from './Icon';
import PermissionLine from './PermissionLine';
import StatusNote from './StatusNote';
import { fetchBans } from '../api';
import { useCan } from '../lib/useCan';
import { useServerList } from '../lib/useServerData';

const LIMIT = 25;

/**
 * Every ban on the server.
 *
 * This closes a real hole rather than adding a second way to see the same
 * thing. A ban hangs off a license, a Discord ID or an IP - not off a
 * character. The citizen card can only ever show the bans that match the
 * character being looked at, so a ban on an identifier with no character
 * behind it in this database was, until now, findable nowhere in the panel
 * and liftable nowhere either. Here it is both.
 *
 * The list is paged on the server. The route answers with the rows of this
 * page and no grand total, so the surface does not claim one: it says which
 * page this is and offers the next only while a full page came back.
 */
export default function BansPanel() {
    const { can } = useCan();
    const canEdit = can('bans.edit');

    const [search, setSearch] = useState('');
    const [page, setPage] = useState(1);
    const [token, setToken] = useState(0);
    const [feedback, setFeedback] = useState(null);

    const res = useServerList(fetchBans, { search, page, limit: LIMIT, token });

    const data = res.data || {};
    const bans = Array.isArray(data.bans) ? data.bans : [];
    const activeCount = bans.filter((ban) => ban.active !== false).length;

    // A short page means the end is reached. That is all the route tells us,
    // so it is all the surface offers.
    const hasNext = bans.length === LIMIT;
    const hasPrev = page > 1;

    const changeSearch = (value) => {
        setSearch(value);
        // A new query starts at the front - page 3 of the old search says
        // nothing about the new one.
        setPage(1);
        setFeedback(null);
    };

    const reload = () => setToken((v) => v + 1);

    return (
        <section className="panel" aria-labelledby="bans-panel-title">
            <header className="panel__head">
                <Icon name="ban" size={18} className="panel__icon" />
                <div>
                    <h2 className="panel__title" id="bans-panel-title">Bans</h2>
                    <p className="panel__hint">{headHint(res, bans.length, activeCount, page)}</p>
                </div>
            </header>

            <div className="panel__body">
                {!canEdit && <PermissionLine what="lift bans" />}

                <p className="field__hint">
                    A ban blocks a license, a Discord ID or an IP — not a character.
                    Bans on an identifier that no character in this database belongs to
                    can be found and lifted here, and nowhere else in the panel.
                </p>

                <div className="field">
                    <label className="field__label" htmlFor="bans-search">Search</label>
                    <input
                        id="bans-search"
                        className="input"
                        type="search"
                        autoComplete="off"
                        placeholder="Name, license, Discord ID or reason"
                        value={search}
                        onChange={(e) => changeSearch(e.target.value)}
                    />
                </div>

                {res.status === 'unavailable' && (
                    <StatusNote
                        tone="warn"
                        title="Bans are not available in this schema"
                        detail={[res.error, res.hint].filter(Boolean).join(' ')}
                    />
                )}

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
                        title="The bans could not be loaded"
                        detail={[res.error, res.hint].filter(Boolean).join(' ')}
                    />
                )}

                {res.waiting && res.status === 'loading' && (
                    <p className="field__hint">Loading the bans…</p>
                )}

                {res.status === 'ready' && bans.length === 0 && (
                    <p className="field__hint">
                        {search
                            ? `No ban matches “${search}”.`
                            : page > 1
                                ? 'This page is empty — there is nothing beyond the previous one.'
                                : 'Nothing is banned on this server.'}
                    </p>
                )}

                {bans.length > 0 && (
                    <ul className={`lines${res.isStale ? ' is-stale' : ''}`} aria-busy={res.isStale}>
                        {bans.map((ban) => (
                            <BanLine
                                key={ban.id}
                                ban={ban}
                                canEdit={canEdit}
                                onFeedback={setFeedback}
                                onChanged={reload}
                            />
                        ))}
                    </ul>
                )}

                {feedback && (
                    <StatusNote tone={feedback.tone} title={feedback.title} detail={feedback.detail} />
                )}
            </div>

            {(hasPrev || hasNext) && (
                <footer className="panel__foot">
                    <span className="panel__footinfo">{`Page ${page}`}</span>
                    <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() => { setPage((p) => Math.max(1, p - 1)); setFeedback(null); }}
                        disabled={!hasPrev || res.isStale}
                    >
                        <Icon name="chevronLeft" size={15} />
                        Previous
                    </button>
                    <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() => { setPage((p) => p + 1); setFeedback(null); }}
                        disabled={!hasNext || res.isStale}
                    >
                        Next
                        <Icon name="chevronRight" size={15} />
                    </button>
                </footer>
            )}
        </section>
    );
}

function headHint(res, shown, active, page) {
    if (res.waiting && res.status === 'loading') return 'Reading the bans';
    if (res.status === 'unavailable') return 'Module unavailable';
    if (res.status === 'unreachable') return 'Game server unreachable';
    if (res.status === 'error') return 'Bans unknown';
    if (shown === 0) return page > 1 ? `Page ${page} · empty` : 'Nothing banned';

    const base = shown === 1 ? '1 ban on this page' : `${shown} bans on this page`;
    return `${base} · ${active} of them still in force`;
}
