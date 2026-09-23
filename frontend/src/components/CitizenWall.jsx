import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import Amount from './Amount';
import Icon from './Icon';
import Plate from './Plate';
import StatusNote from './StatusNote';
import { jobTitle } from '../utils/format';
import { PAGE_SIZE, useRails } from '../lib/useRoster';

/**
 * The wall: rails of tiles running horizontally.
 *
 * The rails expressly describe only the page that was loaded, not the
 * database - the API returns no grand total. The headings are therefore
 * worded so that they claim nothing that has not been verified.
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
                            Everyone below is listed without a verified status. They are not
                            necessarily offline.
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
                            Reported online: {dbMismatch.onlineButUnknown.join(', ')} — none of those
                            citizen IDs exist in “{dbMismatch.configuredDatabase}”. That is why
                            everyone looks offline. Check DB_NAME in .env against
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

/* -------------------------------------------------------------------------
   One rail
   ------------------------------------------------------------------------- */

/**
 * One rail. Exported because the landing page shows the same thing - the
 * citizens on the server right now - and a second rail that merely looked
 * like this one would drift from it at the first change.
 */
export function Rail({ rail, bridgeDown, selectedId, onSelect }) {
    const trackRef = useRef(null);
    const [edges, setEdges] = useState({ start: false, end: false });

    // The arrows only appear when there is anything at all to see in that
    // direction. Otherwise short rails would carry dead buttons.
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

/* -------------------------------------------------------------------------
   One tile
   ------------------------------------------------------------------------- */

// A tile is the narrowest box a balance is ever put in - about 70px beside
// its key at the mid breakpoint. Up to ten million the figure stays exact
// (and shrinks a little if it has to); from there it goes compact, with the
// exact figure in the title. The billboard shows it in full.
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

            {/* Only visible on focus: the details you would otherwise have
                to open the record for. */}
            <span className="tile__reveal" aria-hidden="true">
                <span className="tile__revealinner">
                    {/* One line: the reveal rides up by a fixed distance,
                        so a second line would slide under the caption. The
                        id is spoken in full below and stands on the
                        billboard once the tile is opened. */}
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

/* -------------------------------------------------------------------------
   States
   ------------------------------------------------------------------------- */

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
                    Check the spelling, or search by citizen ID instead of name.
                </p>
            </div>
        );
    }

    if (page > 1) {
        return (
            <div className="empty">
                <Icon name="empty" size={26} className="empty__icon" />
                <p className="empty__title">This page is empty</p>
                <p className="empty__text">There are no further records. Go back a page.</p>
            </div>
        );
    }

    return (
        <div className="empty">
            <Icon name="empty" size={26} className="empty__icon" />
            <p className="empty__title">No records yet</p>
            <p className="empty__text">The database contains no characters.</p>
        </div>
    );
}
