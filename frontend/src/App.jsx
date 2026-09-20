import { useCallback } from 'react';
import { startDiscordLogin } from './api';
import AuthScreen from './components/AuthScreen';
import Workspace from './components/Workspace';
import { useAuth } from './lib/useAuth';
import './App.css';

/**
 * Die Schale beantwortet genau eine Frage: darf hier ueberhaupt gearbeitet
 * werden? Erst wenn sie beantwortet ist, wird das Panel gemountet - vorher
 * liefe jede Datenanfrage in einen 401.
 *
 * Solange /api/auth/me laeuft, steht hier weder Panel noch Login: sonst
 * blitzt bei jedem Reload kurz der Anmeldebildschirm auf, obwohl die
 * Sitzung laengst steht.
 */
function App() {
    const auth = useAuth();

    const handleSignIn = useCallback(() => {
        // Echte Seitennavigation, kein XHR - Discord braucht den Browser.
        startDiscordLogin(auth.loginUrl);
    }, [auth.loginUrl]);

    if (auth.phase === 'loading') {
        return <AuthScreen mode="loading" />;
    }

    // Eigener Zustand: das Backend antwortet nicht. Das als "nicht
    // angemeldet" zu zeigen waere eine Behauptung, die niemand geprueft hat.
    if (auth.phase === 'unreachable') {
        return <AuthScreen mode="offline" error={auth.error} onRetry={auth.recheck} />;
    }

    if (!auth.authenticated) {
        return <AuthScreen mode="signin" notice={auth.notice} onSignIn={handleSignIn} />;
    }

    return (
        <Workspace
            user={auth.user}
            authDisabled={auth.authDisabled}
            warning={auth.warning}
            signingOut={auth.signingOut}
            onSignOut={auth.signOut}
        />
    );
}

export default App;
