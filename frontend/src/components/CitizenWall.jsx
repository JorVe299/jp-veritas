import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import Amount from './Amount';
import Icon from './Icon';
import Plate from './Plate';
import StatusNote from './StatusNote';
import { jobTitle } from '../utils/format';
import { PAGE_SIZE, useRails } from '../lib/useRoster';

/**
 * Citizen wall: horizontal rails of tiles
 * Rails describe the loaded page only: the API returns no grand total
 */
export default function CitizenWall({
    players,
    bridge,
    status,
    error,
    isStale,
    search,
    page,
    onPageChange,
    selectedId,
    onSelect,
}) {
    const bridgeDown = Boolean(bridge && !bridge.reachable);
    const dbMismatch = bridge?.dbMismatch || null;
    const rails = useRails(players, bridgeDown);
    const hasNextPage = players.length === PAGE_SIZE;
    const isFirstLoad = status === 'loading';

    return (
        <section className="wall" aria-label="Citizen catalog">
            {bridgeDown && (
                <StatusNote
                    className="note--wide"
                    tone="warn"
                    title="No connection to the FiveM server — online status is unknown"
                    detail={
                        <>
                            Not necessarily offline.
                            {bridge.error && <> Reported: {bridge.error}</>}
                        </>
                    }
                />
            )}

            {dbMismatch && (
                <StatusNote
                    className="note--wide"
                    tone="error"
                    title="This database does not match the game server"
                    detail={
                        <>
                            Online IDs {dbMismatch.onlineButUnknown.join(', ')} are not in
                            “{dbMismatch.configuredDatabase}”. Check DB_NAME in .env against
                            mysql_connection_string in server.cfg.
                        </>
                    }
                />
            )}

            {status === 'error' && (
                <StatusNote
                    className="note--wide"
                    tone="error"
                    title="The catalog could not be loaded"
                    detail={error}
                />
            )}

            <div className={`wall__body${isStale ? ' is-stale' : ''}`} aria-busy={isStale || isFirstLoad}>
                {isFirstLoad ? (
                    <SkeletonRail />
                ) : players.length === 0 ? (
                    <EmptyWall search={search} page={page} />
                ) : (
                    rails.map((rail) => (
                        <Rail
                            key={rail.id}
                            rail={rail}
                            bridgeDown={bridgeDown}
                            selectedId={selectedId}
                            onSelect={onSelect}
                        />
                    ))
                )}
            </div>

            <div className="wall__foot">
                <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    disabled={page === 1}
                    onClick={() => onPageChange(Math.max(1, page - 1))}
                >
                    <Icon name="chevronLeft" size={16} />
                    Previous
                </button>
                <span className="wall__page u-mono">
                    Page {page}
                    {players.length > 0 && ` · ${players.length} shown`}
                </span>
                <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    disabled={!hasNextPage || isStale}
                    onClick={() => onPageChange(page + 1)}
                >
                    Next
                    <Icon name="chevronRight" size={16} />
                </button>
            </div>
        </section>
    );
}

// --- Rail -----------------------------------------------------------------

/** Exported for the landing page's online rail: one component, no drifting copy */
export function Rail({ rail, bridgeDown, selectedId, onSelect }) {
    const trackRef = useRef(null);
    const [edges, setEdges] = useState({ start: false, end: false });

    // Arrows only where there is more to see: no dead buttons on short rails
    const measure = useCallback(() => {
        const el = trackRef.current;
        if (!el) return;
        const max = el.scrollWidth - el.clientWidth;
        setEdges({
            start: el.scrollLeft > 4,
            end: max > 4 && el.scrollLeft < max - 4,
        });
    }, []);

    useLayoutEffect(() => {
        measure();
        const el = trackRef.current;
        if (!el) return undefined;

        const ro = new ResizeObserver(measure);
        ro.observe(el);
        return () => ro.disconnect();
    }, [measure, rail.players.length]);

    const nudge = (dir) => {
        const el = trackRef.current;
        if (!el) return;
        el.scrollBy({ left: dir * Math.max(el.clientWidth * 0.8, 240), behavior: 'smooth' });
    };

    return (
        <section className="rail" aria-label={rail.title}>
            <header className="rail__head">
                <h2 className={`rail__title u-caps${rail.tone === 'live' ? ' rail__title--live' : ''}`}>
                    {rail.tone === 'live' && <span className="rail__pulse" aria-hidden="true" />}
                    {rail.title}
                </h2>
                <span className="rail__count u-mono">{rail.players.length}</span>

                <div className="rail__nav">
                    <button
                        type="button"
                        className="btn btn--ghost btn--sm btn--icon"
                        onClick={() => nudge(-1)}
                        disabled={!edges.start}
                        aria-label={`Scroll ${rail.title} left`}
                    >
                        <Icon name="chevronLeft" size={16} />
                    </button>
                    <button
                        type="button"
                        className="btn btn--ghost btn--sm btn--icon"
                        onClick={() => nudge(1)}
                        disabled={!edges.end}
                        aria-label={`Scroll ${rail.title} right`}
                    >
                        <Icon name="chevronRight" size={16} />
                    </button>
                </div>
            </header>

            <ul className="rail__track" ref={trackRef} onScroll={measure}>
                {rail.players.map((player) => (
                    <li className="rail__cell" key={player.citizenid}>
                        <Tile
                            player={player}
                            statusUnknown={bridgeDown}
                            isSelected={player.citizenid === selectedId}
                            onSelect={onSelect}
                        />
                    </li>
                ))}
            </ul>
        </section>
    );
}

// --- Tile -----------------------------------------------------------------

// Narrowest balance box (~70px at mid breakpoint); the billboard shows the exact figure
const TILE_COMPACT_FROM = 1e7;

function Tile({ player, statusUnknown, isSelected, onSelect }) {
    const statusText = statusUnknown
        ? 'Status unknown'
        : player.isOnline
            ? 'On the server now'
            : 'Not on the server';

    return (
        <button
            type="button"
            className={`tile${isSelected ? ' is-selected' : ''}`}
            aria-pressed={isSelected}
            onClick={() => onSelect(player)}
        >
            <span className="tile__art">
                <Plate citizenid={player.citizenid} />
                <span className="tile__grain" aria-hidden="true" />
                <span className="tile__scrim" aria-hidden="true" />
            </span>

            {!statusUnknown && player.isOnline && (
                <span className="tile__badge">
                    <span className="tile__badgedot" aria-hidden="true" />
                    Live
                </span>
            )}
            {statusUnknown && (
                <span className="tile__badge tile__badge--unknown">Unverified</span>
            )}

            <span className="tile__caption">
                <span className="tile__name u-display">{player.name}</span>
                <span className="tile__job">{jobTitle(player)}</span>
            </span>

            {/* Shown on focus only: details without opening the record */}
            <span className="tile__reveal" aria-hidden="true">
                <span className="tile__revealinner">
                    {/* One line, clipped: a second would slide under the caption */}
                    <span className="tile__cid u-mono u-clip" title={player.citizenid}>
                        {player.citizenid}
                    </span>
                    <span className="tile__money">
                        <span className="tile__moneyrow">
                            <span className="tile__moneykey u-caps">Cash</span>
                            <Amount
                                value={player.money?.cash}
                                compactFrom={TILE_COMPACT_FROM}
                                className="tile__moneyvalue u-mono u-fit"
                            />
                        </span>
                        <span className="tile__moneyrow">
                            <span className="tile__moneykey u-caps">Bank</span>
                            <Amount
                                value={player.money?.bank}
                                compactFrom={TILE_COMPACT_FROM}
                                className="tile__moneyvalue u-mono u-fit"
                            />
                        </span>
                    </span>
                </span>
            </span>

            <span className="u-sr">
                {statusText}. Citizen ID {player.citizenid}.
            </span>
        </button>
    );
}

// --- States ---------------------------------------------------------------

function SkeletonRail() {
    return (
        <section className="rail" aria-hidden="true">
            <header className="rail__head">
                <span className="skeleton skeleton--title" />
            </header>
            <div className="rail__track rail__track--static">
                {Array.from({ length: 8 }, (_, i) => (
                    <div className="rail__cell" key={i}>
                        <div className="skeleton skeleton--tile" />
                    </div>
                ))}
            </div>
        </section>
    );
}

function EmptyWall({ search, page }) {
    if (search) {
        return (
            <div className="empty">
                <Icon name="search" size={26} className="empty__icon" />
                <p className="empty__title">Nothing matched “{search}”</p>
                <p className="empty__text">
                    Try the citizen ID instead.
                </p>
            </div>
        );
    }

    if (page > 1) {
        return (
            <div className="empty">
                <Icon name="empty" size={26} className="empty__icon" />
                <p className="empty__title">No further records</p>
            </div>
        );
    }

    return (
        <div className="empty">
            <Icon name="empty" size={26} className="empty__icon" />
            <p className="empty__title">No characters in the database</p>
        </div>
    );
}
