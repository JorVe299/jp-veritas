import { useCallback, useEffect } from 'react';
import { startDiscordLogin } from './api';
import AuthScreen from './components/AuthScreen';
import PortalGate from './components/PortalGate';
import PortalScreen from './components/PortalScreen';
import Workspace from './components/Workspace';
import { useAuth } from './lib/useAuth';
import { navigate, PORTAL_PATH, surfaceFor, usePath } from './lib/useSurface';
import './App.css';
// Last on purpose: where Veritas ID reaches into a class the panel also
// uses, it has to be the one that wins.
import './portal.css';

/**
 * Whether this account holds a role in the panel.
 *
 * `role` used to be a string for everyone who got this far. It can now be
 * null, and null is not a weaker role but no access at all: every admin
 * route answers 403 for such an account. So the question is asked once,
 * here, and the answer decides which of the two surfaces a person lands on.
 */
function hasPanelAccess(user) {
    return typeof user?.role === 'string' && user.role.trim() !== '';
}

/**
 * Whether the panel has anything to show this account.
 *
 * Holding a role and being able to use the panel are not the same thing.
 * A role whose capabilities have all been taken away reaches nothing: every
 * card on the panel would 403. Someone in that position who also has a
 * character is better served by Veritas ID than by an empty admin panel.
 *
 * Without a portal they stay on the panel even so, because the empty state
 * there explains what is missing, while Veritas ID could only turn them
 * away - and a dead end that explains itself beats one that does not.
 */
function panelIsUsable(user) {
    if (!hasPanelAccess(user)) return false;
    return Array.isArray(user.capabilities) && user.capabilities.length > 0;
}

/**
 * The shell answers two questions: may any work happen here at all, and
 * which of the two surfaces is being asked for.
 *
 * Only once the first is answered does anything mount - before that, every
 * data request would run into a 401. While /api/auth/me is in flight,
 * neither surface shows its content: otherwise the sign-in screen would
 * flash up on every reload even though the session has long been
 * established.
 */
function App() {
    const auth = useAuth();
    const path = usePath();

    const handleSignIn = useCallback(() => {
        // A real page navigation, not an XHR - Discord needs the browser.
        // Which surface is asking comes out of the address bar at the
        // moment of the click: there is no session yet, so the URL is the
        // only thing that says where this person wants to end up.
        startDiscordLogin(auth.loginUrl, surfaceFor(window.location.pathname));
    }, [auth.loginUrl]);

    const goPortal = useCallback(() => navigate(PORTAL_PATH), []);
    const goPanel = useCallback(() => navigate('/'), []);

    // Without a Discord login configured there is no identity at all: the
    // panel stands open to everyone, and Veritas ID has nothing to work
    // from, since it decides whose characters these are by the account.
    const portalOnly = auth.authenticated
        && !auth.authDisabled
        && !panelIsUsable(auth.user)
        // A role that grants nothing only sends someone here if there is
        // actually something for them to see.
        && (!hasPanelAccess(auth.user) || auth.user?.portal === true);

    /* Derived, never stored. Someone with no role would see an empty panel
       at "/" - every card on it would 403 - so they are shown Veritas ID
       instead of an explanation of things they cannot reach. */
    const portal = surfaceFor(path) === 'portal' || portalOnly;

    /* ...and the address bar is brought into line with that afterwards, so
       a reload lands in the same place. This writes to history only; the
       path is read back out of the URL rather than kept in state, so there
       is no second copy that could disagree - and replace rather than push,
       because a correction nobody asked for must not become a stop on the
       way back out. */
    useEffect(() => {
        if (portal && surfaceFor(window.location.pathname) !== 'portal') {
            navigate(PORTAL_PATH, { replace: true });
        }
    }, [portal]);

    if (portal) {
        if (auth.phase === 'loading') {
            return <PortalGate mode="loading" />;
        }

        // A state of its own: the backend is not answering. Showing that as
        // "not signed in" would be a claim nobody has verified.
        if (auth.phase === 'unreachable') {
            return <PortalGate mode="offline" error={auth.error} onRetry={auth.recheck} />;
        }

        // No Discord on this installation. The panel can run like that;
        // Veritas ID cannot, and says so rather than showing a sign-in
        // button that leads nowhere.
        if (auth.authDisabled) {
            return <PortalGate mode="unavailable" />;
        }

        if (!auth.authenticated) {
            return (
                <PortalGate
                    mode="signin"
                    notice={auth.notice}
                    noticeReason={auth.noticeReason}
                    onSignIn={handleSignIn}
                />
            );
        }

        return (
            <PortalScreen
                user={auth.user}
                signingOut={auth.signingOut}
                onSignOut={auth.signOut}
                /* Only staff are offered the way over, and only staff
                   who can actually do something there: for an account with
                   no role that link is a door onto a 403, and for one whose
                   role grants nothing it is a door onto an empty panel. */
                canOpenPanel={panelIsUsable(auth.user)}
                onOpenPanel={goPanel}
            />
        );
    }

    if (auth.phase === 'loading') {
        return <AuthScreen mode="loading" />;
    }

    if (auth.phase === 'unreachable') {
        return <AuthScreen mode="offline" error={auth.error} onRetry={auth.recheck} />;
    }

    if (!auth.authenticated) {
        return (
            <AuthScreen
                mode="signin"
                notice={auth.notice}
                noticeReason={auth.noticeReason}
                onSignIn={handleSignIn}
            />
        );
    }

    return (
        <Workspace
            user={auth.user}
            authDisabled={auth.authDisabled}
            warning={auth.warning}
            signingOut={auth.signingOut}
            onSignOut={auth.signOut}
            permissionNotice={auth.permissionNotice}
            onDismissPermissionNotice={auth.dismissPermissionNotice}
            onPermissionsChanged={auth.refresh}
            /* The quiet way across, for the staff who are also players.
               Hangs off the portal flag and not off the role: an account
               can hold a role in the panel and still not be in the Discord
               Veritas ID is open to. */
            onOpenPortal={
                auth.user?.portal === true
                /* A session from before Veritas ID existed cannot know
                   whether it belongs here, and hiding the way in leaves
                   someone hunting the panel for a page that is not on it.
                   The portal explains itself in that case, so the door is
                   better open than missing. */
                || auth.user?.portalKnown === false
                    ? goPortal
                    : undefined
            }
        />
    );
}

export default App;
