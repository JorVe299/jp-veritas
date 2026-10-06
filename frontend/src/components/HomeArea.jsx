import Icon from './Icon';
import Mark from './Mark';
import Plate from './Plate';
import StatusNote from './StatusNote';
import { Rail } from './CitizenWall';

/**
 * Landing page: what the installation is doing now, and where to go next
 * Invents nothing (no uptime, no "all healthy"); count gaps are spelled out
 */
export default function HomeArea({
    roleLabel,
    bridge,
    rosterStatus,
    canViewPlayers,
    onlinePlayers = [],
    destinations = [],
    onGoDestination,
    selectedId,
    onSelectPlayer,
}) {
    const bridgeDown = Boolean(bridge && !bridge.reachable);
    const bridgeKnown = Boolean(bridge) && !bridgeDown;

    // The roster is paged: the bridge usually counts more than the page holds
    const onServer = bridgeKnown ? (bridge.onlineCount ?? 0) : null;
    const shown = onlinePlayers.length;
    const hidden = onServer !== null ? Math.max(0, onServer - shown) : 0;

    return (
        <>
            <section className="home">
                <div className="home__art" aria-hidden="true">
                    <Plate citizenid="veritas-home" shape="wide" />
                    <span className="home__grain" />
                    <span className="home__scrim" />
                </div>

                <div className="home__inner">
                    <div className="home__brand">
                        <Mark size={44} />
                        <h1 className="home__word">Veritas</h1>
                    </div>

                    <p className="home__lede">
                        Every citizen on this server, online or not.
                    </p>

                    {/* Only checked facts: nothing here would survive a failed check */}
                    <div className="home__facts">
                        <span className={`pill pill--lg${bridgeDown ? ' pill--unknown' : bridgeKnown ? ' pill--live' : ''}`}>
                            <Icon name={bridgeDown ? 'linkOff' : 'link'} size={15} />
                            {rosterStatus === 'loading' && !bridge
                                ? 'Checking the game server'
                                : bridgeDown
                                    ? 'Game server unreachable · online status unverified'
                                    : bridgeKnown
                                        ? `Game server reachable · ${onServer} on the server`
                                        : 'Game server state unknown'}
                        </span>

                        {roleLabel && (
                            <span className="pill pill--lg">
                                <Icon name="users" size={15} />
                                Signed in as {roleLabel}
                            </span>
                        )}
                    </div>
                </div>
            </section>

            {/* Online citizens first: usually who an admin is about to help */}
            {canViewPlayers && bridgeDown && (
                <StatusNote
                    className="note--wide"
                    tone="warn"
                    title="No connection to the FiveM server — nobody can be listed as online"
                    detail={bridge?.error ? `Reported: ${bridge.error}` : undefined}
                />
            )}

            {canViewPlayers && !bridgeDown && shown > 0 && (
                <Rail
                    rail={{
                        id: 'home-online',
                        title: 'On the server now',
                        tone: 'live',
                        players: onlinePlayers,
                    }}
                    bridgeDown={false}
                    selectedId={selectedId}
                    onSelect={onSelectPlayer}
                />
            )}

            {canViewPlayers && !bridgeDown && hidden > 0 && (
                <p className="home__gap">
                    {hidden} more on the server, not on this page.
                </p>
            )}

            {canViewPlayers && bridgeKnown && shown === 0 && onServer === 0 && (
                <p className="home__gap">Nobody is on the server at the moment.</p>
            )}

            {destinations.length > 0 && (
                <section className="dests" aria-labelledby="home-dests">
                    <h2 className="dests__title u-caps" id="home-dests">Where to go</h2>

                    {/* A list, not a card grid: destinations are scanned down */}
                    <ul className="dests__list">
                        {destinations.map((d) => (
                            <li key={d.id}>
                                <button
                                    type="button"
                                    className="dest"
                                    onClick={() => onGoDestination?.(d)}
                                >
                                    <Icon name={d.icon} size={18} className="dest__icon" />
                                    <span className="dest__text">
                                        <span className="dest__name">{d.label}</span>
                                        <span className="dest__hint">{d.hint}</span>
                                    </span>
                                    <Icon name="chevronRight" size={18} className="dest__go" />
                                </button>
                            </li>
                        ))}
                    </ul>
                </section>
            )}
        </>
    );
}
