import CooldownLabel from './CooldownLabel';
import StatusNote from './StatusNote';
import { useCooldown } from '../lib/useCooldown';

/**
 * A failed request, turned into one sentence a player can act on.
 *
 * Every status the portal can get back means something different, and only
 * two of them mean anything is broken. Lumping them into "could not be
 * loaded" would tell a player who is simply not in the Discord to go and
 * report a bug.
 *
 * Where the server sends words of its own they are used: `error` as the
 * sentence and `hint` as the detail. What stands here is the fallback for
 * when it does not - never a guess about what the server meant.
 */
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

        // Deliberately the same answer whether the character does not exist
        // or belongs to somebody else. The wording must not lean towards
        // either, or it would leak the difference the server withholds.
        case 404:
            return {
                tone: 'warn',
                title: error || 'No such character on your account',
                detail: 'Nothing on your account matches this link. Go back to your characters and pick one from the list.',
            };

        // The portal does not speak this server's framework. Plainly, in the
        // server's own words: nobody here can work out more than it said.
        case 501:
            return {
                tone: 'warn',
                title: error || 'Veritas ID does not support this server yet',
                detail: hint,
            };

        // No response at all. That is the network or a stopped backend, and
        // it is expressly not "you have nothing here".
        case null:
        case undefined:
            return {
                tone: 'error',
                title: 'Veritas ID is not answering',
                detail: error
                    ? `Nothing was loaded, so nothing below is known. Reported: ${error}`
                    : 'Nothing was loaded, so nothing below is known.',
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
 * `cooldownKey` lets a caller share the retry's cooldown with its own retry
 * buttons for the same request. Left out, every notice on the portal shares
 * one: the point is how often the backend is asked, not which card asks.
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

    // Trying again only helps where the answer could turn out differently.
    // A 403 will be a 403 again, and a button that changes nothing is worse
    // than none at all.
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
