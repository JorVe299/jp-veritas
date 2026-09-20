import Icon from './Icon';
import Mark from './Mark';
import SessionMenu from './SessionMenu';

/**
 * Die Kopfleiste traegt vier Dinge und sonst nichts: die Marke, die Suche
 * als schnellsten Weg zu einem Datensatz, den Zustand der Bruecke und den
 * angemeldeten Nutzer.
 *
 * showSession ist false, wenn der Discord-Login gar nicht konfiguriert ist:
 * dann gibt es niemanden, der angemeldet waere, und ein Nutzerfeld waere
 * eine Behauptung. Stattdessen steht dort die Warnleiste darunter.
 */
export default function TopBar({
    search,
    onSearchChange,
    bridge,
    status,
    user,
    showSession = false,
    signingOut = false,
    onSignOut,
}) {
    const bridgeDown = Boolean(bridge && !bridge.reachable);
    const unknown = !bridge || bridgeDown;

    return (
        <header className="topbar">
            <a className="topbar__brand" href="#wall">
                <Mark size={26} />
                <span className="topbar__word">Veritas</span>
            </a>

            <div className="topbar__search">
                <Icon name="search" size={17} className="topbar__searchicon" />
                <label className="u-sr" htmlFor="citizen-search">
                    Search citizens by name or citizen ID
                </label>
                <input
                    id="citizen-search"
                    className="input topbar__input"
                    type="search"
                    placeholder="Search by name or citizen ID…"
                    value={search}
                    autoComplete="off"
                    onChange={(e) => onSearchChange(e.target.value)}
                />
            </div>

            <div
                className={`bridge${bridgeDown ? ' bridge--down' : unknown ? ' bridge--idle' : ' bridge--up'}`}
                title={bridge?.error || undefined}
            >
                <Icon name={bridgeDown ? 'linkOff' : 'link'} size={16} />
                <span className="bridge__text u-caps">
                    {status === 'loading' && !bridge
                        ? 'Checking link'
                        : bridgeDown
                            ? 'Link down · status unverified'
                            : `Live link · ${bridge.onlineCount ?? 0} on server`}
                </span>
            </div>

            {showSession && (
                <SessionMenu user={user} signingOut={signingOut} onSignOut={onSignOut} />
            )}
        </header>
    );
}
