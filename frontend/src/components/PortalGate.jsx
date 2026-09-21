import IdMark from './IdMark';
import StatusNote from './StatusNote';
import { authFeedback } from '../lib/authFeedback';

/**
 * The front door of Veritas ID: everything that is visible while no
 * confirmed session exists.
 *
 * It does the same job as the panel's AuthScreen and deliberately does not
 * look like it. A player arriving here has usually followed a link from the
 * server's Discord and has never seen the admin panel; the first screen
 * should tell them what this is in their own terms, not greet them with a
 * tool for managing other people's characters.
 *
 *   'loading'     - the session is being checked. Neither door nor content,
 *                   or the sign-in would flash up on every reload.
 *   'signin'      - nobody is signed in.
 *   'offline'     - the backend did not answer at all. A state of its own:
 *                   "the server is down" is not "you are not signed in".
 *   'unavailable' - this installation has no Discord login configured, so
 *                   there is no account this could show characters for.
 */

// The message after coming back from Discord. What happened during this
// session outranks the feedback in the address bar: that one is older and
// stops being true the moment somebody signs out.
function noteFor(notice, feedback) {
    if (notice === 'expired') {
        return {
            tone: 'warn',
            title: 'Your session expired',
            detail: 'Sign in with Discord again to see your characters.',
        };
    }

    if (notice === 'signed-out') {
        return {
            tone: 'info',
            title: 'You are signed out',
            detail: 'Sign in again whenever you want to look at your characters.',
        };
    }

    if (!feedback) return null;

    switch (feedback.kind) {
        case 'denied':
            return {
                tone: 'warn',
                title: 'Access not granted',
                detail: feedback.reason
                    || 'Your Discord account signed in, but it is not cleared for Veritas ID.',
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
            // Discord said yes and the session still is not there: almost
            // always blocked cookies. That is a statement of its own.
            return {
                tone: 'warn',
                title: 'Signed in, but no session was kept',
                detail: 'Discord accepted the sign-in and this browser did not keep the session cookie. Allow cookies for this site, then try again.',
            };
        default:
            return null;
    }
}

export default function PortalGate({ mode, notice = null, error = null, onSignIn, onRetry }) {
    const note = mode === 'signin' ? noteFor(notice, authFeedback) : null;

    return (
        <main className="idgate">
            <section className="idgate__card">
                <div className="idgate__brand">
                    <IdMark size={34} />
                    <span className="idgate__word">
                        Veritas<span className="idbar__word-id">ID</span>
                    </span>
                </div>

                {mode === 'loading' && (
                    <div className="idgate__block" role="status">
                        <p className="idgate__text">Checking your session…</p>
                        <span className="skeleton skeleton--title" />
                    </div>
                )}

                {mode === 'signin' && (
                    <div className="idgate__block">
                        <h1 className="idgate__title">Your characters on this server</h1>
                        <p className="idgate__text">
                            Sign in with the Discord account you play on and Veritas ID shows
                            you what the server has on record for your characters — their
                            papers, their job, their money, what they are carrying and what
                            they drive. Looking only: nothing here can be changed.
                        </p>
                        <button type="button" className="btn btn--primary idgate__action" onClick={onSignIn}>
                            Sign in with Discord
                        </button>
                        {note && <StatusNote tone={note.tone} title={note.title} detail={note.detail} />}
                    </div>
                )}

                {mode === 'offline' && (
                    <div className="idgate__block">
                        <h1 className="idgate__title">Veritas ID is not answering</h1>
                        <p className="idgate__text">
                            The server did not answer when asked whether you are signed in. It
                            may be restarting. Nothing is known about your session until it
                            does, so nothing is shown.
                        </p>
                        <StatusNote tone="error" title="Session check failed" detail={error} />
                        <button type="button" className="btn idgate__action" onClick={onRetry}>
                            Try again
                        </button>
                    </div>
                )}

                {mode === 'unavailable' && (
                    <div className="idgate__block">
                        <h1 className="idgate__title">Veritas ID is not set up here</h1>
                        <p className="idgate__text">
                            This installation has no Discord sign-in configured. Veritas ID
                            works out which characters are yours from your Discord account, so
                            without one there is nobody it could show. Ask whoever runs the
                            server to set it up.
                        </p>
                    </div>
                )}
            </section>
        </main>
    );
}
