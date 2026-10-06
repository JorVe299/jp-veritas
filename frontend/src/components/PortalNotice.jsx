import CooldownLabel from './CooldownLabel';
import StatusNote from './StatusNote';
import { useCooldown } from '../lib/useCooldown';

// One wording per status: lumped together, a 403 would read as a bug to report
// The server's `error`/`hint` win; these are fallbacks, never a guess at its meaning
function wordsFor(code, error, hint) {
    switch (code) {
        case 401:
            return {
                tone: 'info',
                title: 'You are signed out',
                detail: 'Sign in with Discord again to see your characters.',
            };

        case 403:
            return {
                tone: 'warn',
                title: error || 'This account cannot use Veritas ID',
                detail: hint
                    || 'Your Discord account is signed in, but it is not cleared for Veritas ID.',
            };

        // Same wording for missing and not-yours: must not leak what the server withholds
        case 404:
            return {
                tone: 'warn',
                title: error || 'No such character on your account',
                detail: 'Pick one from your characters.',
            };

        // Unsupported framework: the server's words only, nothing added
        case 501:
            return {
                tone: 'warn',
                title: error || 'Veritas ID does not support this server yet',
                detail: hint,
            };

        // No response (network or backend down): never "you have nothing here"
        case null:
        case undefined:
            return {
                tone: 'error',
                title: 'Veritas ID is not answering',
                detail: error
                    ? `Nothing was loaded. Reported: ${error}`
                    : 'Nothing was loaded.',
            };

        default:
            return {
                tone: 'error',
                title: error || 'This could not be loaded',
                detail: hint,
            };
    }
}

/**
 * `cooldownKey` shares the retry cooldown with the caller's own retry buttons
 * Default: one cooldown portal-wide; what counts is how often the backend is asked
 */
export default function PortalNotice({
    code = null,
    error = null,
    hint = null,
    onRetry = null,
    cooldownKey = 'portal-retry',
}) {
    const note = wordsFor(code, error, hint);
    const cooldown = useCooldown(cooldownKey);

    // Retry only where the answer can change; a 403 stays a 403
    const retryable = Boolean(onRetry) && (code === null || code === undefined || code >= 500);

    const retry = () => {
        cooldown.start();
        onRetry();
    };

    return (
        <div className="idfail">
            <StatusNote tone={note.tone} title={note.title} detail={note.detail} />
            {retryable && (
                <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={retry}
                    disabled={!cooldown.ready}
                >
                    <CooldownLabel text="Try again" remaining={cooldown.remaining} />
                </button>
            )}
        </div>
    );
}
