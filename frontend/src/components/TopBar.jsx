import Icon from './Icon';
import Mark from './Mark';
import SessionMenu from './SessionMenu';

/**
 * The top bar carries the wordmark, which is the way back to the start page,
 * the switch between the two working areas, the search as the fastest way to
 * a record, the state of the bridge, the signed-in user - and, for an
 * account that also plays here, one quiet link across to Veritas ID.
 *
 * The start page is reached through the wordmark rather than through the
 * area switch. The switch is for the two places work happens; home is not
 * one of them, and a third button there would suggest it was.
 *
 * The area switch appears only when there are in fact two areas to switch
 * between. A role with none of the server permissions never sees it - an
 * empty second area would be a door onto a wall.
 *
 * The search belongs to the citizen area and is hidden in the server one.
 * It searches the citizen list; left standing there it would look like it
 * searched whatever was on screen, and typing into it would appear broken.
 * A spacer takes its place so the bridge and the session keep their side.
 *
 * showSession is false when the Discord login is not configured at all: then
 * there is nobody who could be signed in, and a user field would be a claim.
 * Instead the warning bar stands below it.
 *
 * Access to the permission matrix hangs here and not in the session field:
 * without a Discord login there is no session field, but there is - because
 * nobody has a role then and the backend lets everything through - the
 * option to set permissions. In a menu that does not exist it would be lost.
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

    // One area is no choice, so no switch is offered for it.
    const switchable = areas.length > 1;
    const showSearch = searchable && activeArea === 'citizens';

    return (
        <header className="topbar">
            {/* The wordmark is the way home, as it is on every other site.
                It stays pressable while already there - going home from home
                is a no-op, but a control that vanishes under the cursor is
                worse than one that does nothing. aria-current says which of
                the two is the case. */}
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

            {/* Without the right to the citizen list there is nothing to
                search, and in the server area there is nothing here to
                search either. A search field with no subject would be no
                explanation but a dead end - the reason stands once
                on the stage below. */}
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

            {/* Holds the place the search would take, so the bridge and the
                session stay on their side of the bar instead of sliding
                left the moment the field goes. */}
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
                                /* Without players.view the wall is never
                                   loaded, so we never learn the state of
                                   the bridge. Nothing is claimed then. */
                                : 'Link status unknown'}
                </span>
            </div>

            {/* The way over to Veritas ID, for the staff who are also
                players on this server. Deliberately the quietest control in
                the bar: it leads out of the panel, and nobody working in
                here is looking for it. It appears only when the account may
                actually use the portal - a role in the panel and access to
                Veritas ID are two different things. */}
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
