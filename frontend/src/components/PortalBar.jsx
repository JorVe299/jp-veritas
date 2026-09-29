import IdMark from './IdMark';
import PortalAvatar from './PortalAvatar';

/**
 * Veritas ID header; no search, area switch or bridge state: it must not read as the panel
 * "Read only" sits by the wordmark, not on each card: it holds for every screen
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
    // The bar truncates the name; the title holds it in full, plus the handle
    const fullName = user?.username && user.username !== name ? `${name} (${user.username})` : name;

    return (
        <header className="idbar">
            {/* Stays pressable at home: a no-op beats a control vanishing under the cursor */}
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

            {/* Role holders only: every admin route answers 403 to a portal-only player */}
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
