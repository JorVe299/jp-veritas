import { useCallback, useEffect } from 'react';
import { startDiscordLogin } from './api';
import AuthScreen from './components/AuthScreen';
import PortalGate from './components/PortalGate';
import PortalScreen from './components/PortalScreen';
import Workspace from './components/Workspace';
import { useAuth } from './lib/useAuth';
import { navigate, PORTAL_PATH, surfaceFor, usePath } from './lib/useSurface';
import './App.css';
// Last: portal.css must win where it overrides panel classes
import './portal.css';

// Null role is no access, not a lesser role: every admin route answers 403
function hasPanelAccess(user) {
    return typeof user?.role === 'string' && user.role.trim() !== '';
}

// A role without capabilities reaches nothing: every card would 403
function panelIsUsable(user) {
    if (!hasPanelAccess(user)) return false;
    return Array.isArray(user.capabilities) && user.capabilities.length > 0;
}

/**
 * Shell: settles the session first, then picks the surface (panel or Veritas ID)
 * Nothing mounts before /api/auth/me answers: data requests would 401, sign-in would flash
 */
function App() {
    const auth = useAuth();
    const path = usePath();

    const handleSignIn = useCallback(() => {
        // Surface read from the URL at click time: without a session nothing else says it
        startDiscordLogin(auth.loginUrl, surfaceFor(window.location.pathname));
    }, [auth.loginUrl]);

    const goPortal = useCallback(() => navigate(PORTAL_PATH), []);
    const goPanel = useCallback(() => navigate('/'), []);

    // Auth disabled means no account: Veritas ID could not tell whose characters to show
    const portalOnly = auth.authenticated
        && !auth.authDisabled
        && !panelIsUsable(auth.user)
        // Empty role without portal access stays on the panel: its empty state explains
        && (!hasPanelAccess(auth.user) || auth.user?.portal === true);

    // Derived, never stored: the URL is the only copy of the path
    const portal = surfaceFor(path) === 'portal' || portalOnly;

    // URL follows so a reload lands here; replace: an unrequested redirect is no Back stop
    useEffect(() => {
        if (portal && surfaceFor(window.location.pathname) !== 'portal') {
            navigate(PORTAL_PATH, { replace: true });
        }
    }, [portal]);

    if (portal) {
        if (auth.phase === 'loading') {
            return <PortalGate mode="loading" />;
        }

        // Unreachable, not signed out: that would be an unverified claim
        if (auth.phase === 'unreachable') {
            return <PortalGate mode="offline" error={auth.error} onRetry={auth.recheck} />;
        }

        // No Discord: Veritas ID cannot run, so no sign-in button that leads nowhere
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
                /* Usable, not merely role-holding: an empty role would open an empty panel */
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
            /* Portal flag, not role: a panel role does not imply Veritas ID access */
            onOpenPortal={auth.user?.portal === true ? goPortal : undefined}
        />
    );
}

export default App;
