import Icon from './Icon';
import Mark from './Mark';
import Plate from './Plate';
import StatusNote from './StatusNote';
import { Rail } from './CitizenWall';

/**
 * The landing page behind the wordmark.
 *
 * Every other surface in this panel begins with something already chosen -
 * a citizen, or a section of the server. This one begins with nothing, and
 * that is its job: say what the installation is doing right now, and offer
 * the two or three places worth going next.
 *
 * What it must not do is invent. There is no uptime here, no session count,
 * no "all systems healthy": the panel knows how many citizens the bridge
 * reports and which of them are on the loaded page, and it says exactly
 * that much. Where those two numbers disagree, the difference is spelled
 * out rather than smoothed over - the same rule the rest of the panel
 * follows for "offline" versus "unverified".
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

    // How many the bridge says are connected, against how many of those the
    // loaded page actually holds. The roster is paged, so the second number
    // is usually the smaller one - and saying so is the honest version.
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
                    <p className="home__sub">
                        Change a job, a balance, an inventory or a licence — live on the
                        running server when the citizen is connected, straight in the
                        database when they are not. The panel always tells you which of
                        the two happened.
                    </p>

                    {/* Facts, not a dashboard. Each chip is something that was
                        actually checked; nothing stands here that would still
                        be shown if the check had failed. */}
                    <div className="home__facts">
                        <span className={`chip${bridgeDown ? ' chip--warn' : bridgeKnown ? ' chip--live' : ''}`}>
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
                            <span className="chip">
                                <Icon name="users" size={15} />
                                Signed in as {roleLabel}
                            </span>
                        )}
                    </div>
                </div>
            </section>

            {/* The fastest route into the work: whoever is connected right
                now is who an admin is usually about to fix something for. */}
            {canViewPlayers && bridgeDown && (
                <StatusNote
                    className="note--wide"
                    tone="warn"
                    title="No connection to the FiveM server — nobody can be listed as online"
                    detail={
                        <>
                            The database is readable, so the citizen list works. Only who is
                            connected cannot be established.
                            {bridge?.error && <> Reported: {bridge.error}</>}
                        </>
                    }
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

            {/* The roster is paged. When the bridge counts more than this page
                carries, the gap is named instead of quietly dropped. */}
            {canViewPlayers && !bridgeDown && hidden > 0 && (
                <p className="home__gap">
                    {hidden} more {hidden === 1 ? 'citizen is' : 'citizens are'} on the server
                    but not on the first page of records — search for them by name or citizen ID.
                </p>
            )}

            {canViewPlayers && bridgeKnown && shown === 0 && onServer === 0 && (
                <p className="home__gap">Nobody is on the server at the moment.</p>
            )}

            {destinations.length > 0 && (
                <section className="dests" aria-labelledby="home-dests">
                    <h2 className="dests__title u-caps" id="home-dests">Where to go</h2>

                    {/* A list, not a grid of cards: these are destinations to
                        scan down, and each one earns its row by saying what is
                        actually behind it. */}
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
