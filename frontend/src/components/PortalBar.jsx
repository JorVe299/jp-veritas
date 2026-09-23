import IdMark from './IdMark';
import PortalAvatar from './PortalAvatar';

/**
 * The header of Veritas ID.
 *
 * It carries four things: which surface this is, that nothing here can be
 * changed, who is signed in, and - for staff who also work in the panel -
 * the way over to it.
 *
 * What it deliberately does not carry is everything the panel's bar has: no
 * search, because there is nothing to search through when the list is your
 * own two characters; no area switch, because there is one area; no state
 * of the bridge, because that is an operator's concern and a player can do
 * nothing with it. The bar is short on purpose - it is the clearest signal
 * that this is not the control room.
 *
 * The "Read only" tag sits next to the wordmark rather than on each card.
 * It is true of every screen here, and something true everywhere belongs
 * where the surface names itself.
 */
export default function PortalBar({
    user,
    atHome = true,
    onGoHome,
    canOpenPanel = false,
    onOpenPanel,
    signingOut = false,
    onSignOut,
}) {
    const name = user?.globalName || user?.username || 'Signed in';
    // Cut to fit the bar, so the title holds all of it - and the handle,
    // where that is not what is shown.
    const fullName = user?.username && user.username !== name ? `${name} (${user.username})` : name;

    return (
        <header className="idbar">
            {/* Home is the wordmark, as it is in the panel and on every
                other site. It stays pressable while already there: going
                home from home does nothing, but a control that disappears
                under the cursor is worse than one that does nothing. */}
            <button
                type="button"
                className={`idbar__brand${atHome ? ' is-here' : ''}`}
                onClick={onGoHome}
                aria-current={atHome ? 'page' : undefined}
            >
                <IdMark size={26} />
                <span className="idbar__word">
                    Veritas<span className="idbar__word-id">ID</span>
                </span>
                <span className="u-sr">— go to your characters</span>
            </button>

            <span className="idbar__tag u-caps">Read only</span>

            <span className="idbar__spacer" aria-hidden="true" />

            {/* Only for an account that actually holds a role. Offering the
                panel to a portal-only player would be a door onto a 403:
                every admin route answers with one for them. */}
            {canOpenPanel && (
                <button type="button" className="btn btn--ghost btn--sm" onClick={onOpenPanel}>
                    Admin panel
                </button>
            )}

            <span className="idbar__who">
                <PortalAvatar name={name} url={user?.avatarUrl} />
                <span className="idbar__name" title={fullName}>{name}</span>
            </span>

            <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={onSignOut}
                disabled={signingOut}
            >
                {signingOut ? 'Signing out…' : 'Sign out'}
            </button>
        </header>
    );
}
