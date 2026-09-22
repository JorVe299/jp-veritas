import { useCallback } from 'react';
import PortalBar from './PortalBar';
import { PlateSprite } from './Plate';
import PortalCharacter from './PortalCharacter';
import PortalNotice from './PortalNotice';
import PortalRoster from './PortalRoster';
import { usePortalAccount } from '../lib/usePortal';
import { characterIdFor, characterPath, navigate, PORTAL_PATH, usePath } from '../lib/useSurface';

/**
 * Veritas ID: the whole of the player-facing surface.
 *
 * Two screens - the account with its characters, and one character - and
 * the address bar decides which. /id is the list, /id/<citizenid> is the
 * character, and both are real URLs a player can bookmark or be sent in a
 * Discord message, because the backend serves index.html for any path that
 * is not /api.
 *
 * Nothing here writes. The bar says so, the screens have no controls that
 * suggest otherwise, and the only requests this surface makes are four
 * GETs the server scopes to the signed-in account.
 */
export default function PortalScreen({
    user,
    signingOut = false,
    onSignOut,
    canOpenPanel = false,
    onOpenPanel,
}) {
    const path = usePath();
    const account = usePortalAccount();

    const characters = Array.isArray(account.data?.characters) ? account.data.characters : [];
    const wanted = characterIdFor(path);

    // With exactly one character there is nothing to choose, so the choice
    // is not offered: the character stands where the picker would be. This
    // is derived from the answer rather than redirected to - a redirect
    // would put a step in the history that only ever bounces.
    const only = characters.length === 1 ? (characters[0]?.citizenid ?? null) : null;
    const activeId = wanted || only;

    // What the list already knows about this character, so the heading is
    // right while the detail request is still running. Missing when the
    // link points at something this account does not have - the detail
    // request then answers 404 and says so.
    const summary = characters.find((entry) => entry?.citizenid === activeId) || null;

    // A way back is offered where there is somewhere to go back to. For the
    // one-character account that entered by itself there is not, and for a
    // link that led nowhere there is.
    const showBack = Boolean(wanted) && wanted !== only;

    const goHome = useCallback(() => {
        navigate(PORTAL_PATH);
        window.scrollTo({ top: 0 });
    }, []);

    const openCharacter = useCallback((citizenid) => {
        navigate(characterPath(citizenid));
        window.scrollTo({ top: 0 });
    }, []);

    return (
        <div className="id">
            {/* The palm outline the generated plates reference by <use>.
                It has to stand in the document that draws them, and this
                surface draws its own now. */}
            <PlateSprite />

            <PortalBar
                user={user}
                /* Whether the address bar is at the list, not whether a
                   character is on screen: the single-character account is
                   shown its character while standing at /id, and the
                   wordmark there leads nowhere else. */
                atHome={!wanted}
                onGoHome={goHome}
                canOpenPanel={canOpenPanel}
                onOpenPanel={onOpenPanel}
                signingOut={signingOut}
                onSignOut={onSignOut}
            />

            <main className="idmain">
                {account.status === 'loading' && (
                    <div className="idhero" role="status">
                        <span className="skeleton idhero__ghost" />
                        <div className="idhero__text">
                            <span className="skeleton skeleton--title" />
                        </div>
                    </div>
                )}

                {/* The account request is the one everything else hangs off:
                    it is what establishes whose characters these are. When
                    it does not answer, nothing below it is shown - a
                    character loaded next to "we do not know who you are"
                    would be the wrong kind of confidence. */}
                {account.status === 'failed' && (
                    <PortalNotice
                        code={account.code}
                        error={account.error}
                        hint={account.hint}
                        onRetry={account.reload}
                    />
                )}

                {account.status === 'ready' && (
                    activeId ? (
                        <PortalCharacter
                            /* Remount rather than update: a different
                               character must start from nothing, not from
                               the last one's data under a new name. */
                            key={activeId}
                            citizenid={activeId}
                            summary={summary}
                            onBack={showBack ? goHome : null}
                        />
                    ) : (
                        <PortalRoster account={account.data} onOpen={openCharacter} />
                    )
                )}
            </main>

            <footer className="idfoot">
                <p className="idfoot__text">
                    Veritas ID shows what this server has on record for your characters.
                    Nothing on this page can be changed from here — if something looks
                    wrong, take it to the server staff.
                </p>
            </footer>
        </div>
    );
}
