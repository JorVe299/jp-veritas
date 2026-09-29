import CooldownLabel from './CooldownLabel';
import IdMark from './IdMark';
import StatusNote from './StatusNote';
import { authFeedback } from '../lib/authFeedback';
import { useCooldown } from '../lib/useCooldown';

// Session notices outrank the address-bar feedback: that is older and stale after sign-out
function noteFor(notice, reason, feedback) {
    // The server's own reason stands alone; generic text beside it would blur it
    if (notice === 'ended' && reason) {
        return {
            tone: 'warn',
            title: 'You were signed out',
            detail: reason,
        };
    }

    if (notice === 'expired' || notice === 'ended') {
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
            // Discord said yes but no session exists: almost always blocked cookies
            return {
                tone: 'warn',
                title: 'Signed in, but no session was kept',
                detail: 'Discord accepted the sign-in and this browser did not keep the session cookie. Allow cookies for this site, then try again.',
            };
        default:
            return null;
    }
}

/**
 * Veritas ID without a confirmed session; unlike the panel's AuthScreen, written for players
 * `loading` shows no door, or sign-in would flash on every reload
 * `offline` (no answer) stays distinct from `signin`: "server down" is not "signed out"
 */
export default function PortalGate({ mode, notice = null, noticeReason = null, error = null, onSignIn, onRetry }) {
    const note = mode === 'signin' ? noteFor(notice, noticeReason, authFeedback) : null;

    // Survives the recheck's unmount; key shared with the panel's sign-in (same session route)
    const retryCooldown = useCooldown('session-recheck');
    const retry = () => {
        retryCooldown.start();
        onRetry();
    };

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
                        <button
                            type="button"
                            className="btn idgate__action"
                            onClick={retry}
                            disabled={!retryCooldown.ready}
                        >
                            <CooldownLabel text="Try again" remaining={retryCooldown.remaining} />
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
