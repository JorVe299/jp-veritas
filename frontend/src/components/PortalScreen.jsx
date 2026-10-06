import { useCallback } from 'react';
import PortalBans from './PortalBans';
import PortalBar from './PortalBar';
import { PlateSprite } from './Plate';
import PortalCharacter from './PortalCharacter';
import PortalNotice from './PortalNotice';
import PortalRoster from './PortalRoster';
import { usePortalAccount } from '../lib/usePortal';
import { characterIdFor, characterPath, navigate, PORTAL_PATH, usePath } from '../lib/useSurface';

/**
 * Veritas ID: /id lists the characters, /id/<citizenid> shows one
 * Both are real URLs: the backend serves index.html for any non-/api path
 * Read-only: four GETs, scoped by the server to the signed-in account
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

    // A lone character stands in for the picker; derived, not redirected: no bounce in history
    const only = characters.length === 1 ? (characters[0]?.citizenid ?? null) : null;
    const activeId = wanted || only;

    // Roster carries the ban record; a lone character replaces the roster, so it carries it instead
    const standsIn = Boolean(only) && activeId === only;

    // Heading while the detail loads; null for an id not on this account (detail then 404s)
    const summary = characters.find((entry) => entry?.citizenid === activeId) || null;

    // Back only where somewhere else exists: not for a lone character, yes for a dead link
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
            {/* Plates reference this sprite via <use>: it must be in the same document */}
            <PlateSprite />

            <PortalBar
                user={user}
                /* By URL, not by view: a lone character is shown at /id */
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

                {/* Account failed: nothing else renders beside an unknown owner */}
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
                        <>
                            <PortalCharacter
                                /* Remount: never the last character's data under a new name */
                                key={activeId}
                                citizenid={activeId}
                                summary={summary}
                                onBack={showBack ? goHome : null}
                            />

                            {/* Outside the character: not held back by a slow or failed detail */}
                            {standsIn && <PortalBans />}
                        </>
                    ) : (
                        <PortalRoster account={account.data} onOpen={openCharacter} />
                    )
                )}
            </main>

            <footer className="idfoot">
                <p className="idfoot__text">
                    Read-only. If something looks wrong, ask the server staff.
                </p>
            </footer>
        </div>
    );
}
