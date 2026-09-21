import Mark from './Mark';
import StatusNote from './StatusNote';
import { authFeedback } from '../lib/authFeedback';

/**
 * The antechamber: everything that is visible as long as no confirmed
 * session exists. Three states, deliberately in one component, because they
 * share the same quiet surface and flow into one another.
 *
 *   'loading'  - the session is being checked. Expressly neither panel nor
 *                login here, otherwise the login flashes up on every reload.
 *   'signin'   - nobody signed in.
 *   'offline'  - /api/auth/me itself did not answer. A state of its own,
 *                because "backend dead" is not "you are not signed in".
 *
 * No player list, no empty cards in the background.
 */

// The message on the sign-in screen. What happened during this session takes
// precedence over the feedback from the address bar: that one is older and
// no longer true after a sign-out.
function noteFor(notice, feedback) {
    if (notice === 'expired') {
        return {
            tone: 'warn',
            title: 'Your session expired, please sign in again',
            detail: 'The panel stopped accepting this session, so you were signed out.',
        };
    }

    if (notice === 'signed-out') {
        return {
            tone: 'info',
            title: 'You are signed out',
            detail: 'Sign in again to keep working.',
        };
    }

    if (!feedback) return null;

    switch (feedback.kind) {
        case 'denied':
            return {
                tone: 'warn',
                title: 'Access not granted',
                detail: feedback.reason
                    || 'Your Discord account signed in, but it is not cleared for this panel.',
            };
        case 'cancelled':
            return {
                tone: 'info',
                title: 'Sign-in cancelled',
                detail: 'The Discord dialog was closed before it finished. Nothing was changed.',
            };
        case 'error':
            return {
                tone: 'error',
                title: 'Sign-in failed',
                detail: feedback.reason || 'Discord returned an unexpected error. Please try again.',
            };
        case 'ok':
            // Discord confirmed, but /api/auth/me knows of no session:
            // almost always blocked cookies. That is a statement of its own.
            return {
                tone: 'warn',
                title: 'Signed in, but no session was kept',
                detail: 'Discord accepted the sign-in and this browser did not keep the session cookie. Allow cookies for this site, then try again.',
            };
        default:
            return null;
    }
}

export default function AuthScreen({ mode, notice = null, error, onSignIn, onRetry }) {
    const note = mode === 'signin' ? noteFor(notice, authFeedback) : null;

    return (
        <main className="gate">
            <span className="gate__grain" aria-hidden="true" />

            <section className="gate__card">
                <div className="gate__brand">
                    <Mark size={30} />
                    <span className="gate__word">Veritas</span>
                </div>

                {mode === 'loading' && (
                    <div className="gate__block" role="status">
                        <p className="gate__text">Checking your session…</p>
                        <span className="skeleton skeleton--title" />
                    </div>
                )}

                {mode === 'signin' && (
                    <div className="gate__block">
                        <h1 className="gate__title u-display">Sign in to continue</h1>
                        <p className="gate__text">
                            Veritas manages jobs, balances, inventories and vehicles for every
                            citizen on this server. Access is granted through Discord.
                        </p>
                        <button type="button" className="btn btn--primary gate__action" onClick={onSignIn}>
                            Sign in with Discord
                        </button>
                        {note && <StatusNote tone={note.tone} title={note.title} detail={note.detail} />}
                    </div>
                )}

                {mode === 'offline' && (
                    <div className="gate__block">
                        <h1 className="gate__title u-display">Panel unreachable</h1>
                        <p className="gate__text">
                            The panel backend did not answer when asked whether you are signed in.
                            It may be restarting. Nothing is known about your session until it does.
                        </p>
                        <StatusNote tone="error" title="Session check failed" detail={error} />
                        <button type="button" className="btn gate__action" onClick={onRetry}>
                            Try again
                        </button>
                    </div>
                )}
            </section>
        </main>
    );
}
