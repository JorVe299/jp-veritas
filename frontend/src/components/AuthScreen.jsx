import CooldownLabel from './CooldownLabel';
import Mark from './Mark';
import StatusNote from './StatusNote';
import { authFeedback } from '../lib/authFeedback';
import { useCooldown } from '../lib/useCooldown';

// Session notices outrank the address-bar feedback: that is older and stale after a sign-out
function noteFor(notice, reason, feedback) {
    // The server's own reason is the whole explanation; no generic sentence beside it
    if (notice === 'ended' && reason) {
        return {
            tone: 'warn',
            title: 'Your session was ended, please sign in again',
            detail: reason,
        };
    }

    if (notice === 'expired' || notice === 'ended') {
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
            // Discord ok, yet no session in /api/auth/me: almost always blocked cookies
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
 * Everything shown while no confirmed session exists: mode 'loading' | 'signin' | 'offline'
 * loading: neither panel nor sign-in, or sign-in would flash on every reload
 * offline: /api/auth/me did not answer; a dead backend is not a signed-out user
 */
export default function AuthScreen({ mode, notice = null, noticeReason = null, error, onSignIn, onRetry }) {
    const note = mode === 'signin' ? noteFor(notice, noticeReason, authFeedback) : null;

    // Cooldown outlives the unmount during the recheck's loading state;
    // key shared with the portal's gate: same session route
    const retryCooldown = useCooldown('session-recheck');
    const retry = () => {
        retryCooldown.start();
        onRetry();
    };

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
                        <button
                            type="button"
                            className="btn gate__action"
                            onClick={retry}
                            disabled={!retryCooldown.ready}
                        >
                            <CooldownLabel text="Try again" remaining={retryCooldown.remaining} />
                        </button>
                    </div>
                )}
            </section>
        </main>
    );
}
