import Icon from './Icon';
import Mark from './Mark';
import SessionMenu from './SessionMenu';

/**
 * Home is the wordmark, not an area button: home is not a work area
 * showSession is false without a configured Discord login: nobody could be signed in
 * Permissions sits here, not in SessionMenu: it must stay reachable without a login
 */
export default function TopBar({
    search,
    onSearchChange,
    searchable = true,
    areas = [],
    activeArea = 'citizens',
    onAreaChange,
    atHome = false,
    onGoHome,
    bridge,
    status,
    user,
    roleLabel = null,
    showSession = false,
    showPermissions = false,
    onOpenPermissions,
    onOpenPortal,
    signingOut = false,
    onSignOut,
}) {
    const bridgeDown = Boolean(bridge && !bridge.reachable);
    const unknown = !bridge || bridgeDown;

    const switchable = areas.length > 1;
    const showSearch = searchable && activeArea === 'citizens';

    return (
        <header className="topbar">
            {/* Stays enabled at home: a no-op beats a control vanishing under the cursor */}
            <button
                type="button"
                className={`topbar__brand${atHome ? ' is-here' : ''}`}
                onClick={onGoHome}
                aria-current={atHome ? 'page' : undefined}
            >
                <Mark size={26} />
                <span className="topbar__word">Veritas</span>
                <span className="u-sr">— go to the start page</span>
            </button>

            {switchable && (
                <div className="segment topbar__areas" role="group" aria-label="Main area">
                    {areas.map((area) => (
                        <button
                            key={area.id}
                            type="button"
                            className="segment__btn"
                            aria-pressed={area.id === activeArea}
                            onClick={() => onAreaChange?.(area.id)}
                        >
                            <Icon name={area.icon} size={15} />
                            {area.label}
                        </button>
                    ))}
                </div>
            )}

            {/* Citizen-list search only: elsewhere typing into it would seem broken */}
            {showSearch && (
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
            )}

            {/* Keeps bridge and session right-aligned while the search is hidden */}
            {!showSearch && <div className="topbar__spacer" aria-hidden="true" />}

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
                            : bridge
                                ? `Live link · ${bridge.onlineCount ?? 0} on server`
                                /* No players.view: the bridge is never read; claim nothing */
                                : 'Link status unknown'}
                </span>
            </div>

            {/* Kept quiet: it leads out of the panel; portal access is not a panel role */}
            {onOpenPortal && (
                <button
                    type="button"
                    className="btn btn--ghost btn--sm topbar__portal"
                    onClick={onOpenPortal}
                >
                    <Icon name="id" size={15} />
                    Veritas ID
                </button>
            )}

            {showPermissions && (
                <button
                    type="button"
                    className="btn btn--ghost btn--sm topbar__perms"
                    onClick={onOpenPermissions}
                >
                    <Icon name="users" size={15} />
                    Permissions
                </button>
            )}

            {showSession && (
                <SessionMenu
                    user={user}
                    roleLabel={roleLabel}
                    signingOut={signingOut}
                    onSignOut={onSignOut}
                />
            )}
        </header>
    );
}
