import Icon from './Icon';
import { useCan } from '../lib/useCan';

/**
 * The one line that explains why nothing can be changed in this card.
 *
 * Exactly once per card, not on every button: twelve identical notices next
 * to twelve grey buttons are no longer a notice but noise. The card stays,
 * the values stay readable - only the changing falls away, and that is what
 * this line says.
 *
 * `what` is the verb together with its object and is put into the sentence:
 * "change balances" becomes "Your role (Supporter) cannot change balances."
 */
export default function PermissionLine({ what }) {
    const { roleLabel } = useCan();

    return (
        <p className="denied">
            <Icon name="info" size={15} className="denied__icon" />
            <span>
                {/* Without a known label the role is not named rather than
                    invented - the statement still holds. */}
                {roleLabel
                    ? `Your role (${roleLabel}) cannot ${what}.`
                    : `You are not allowed to ${what}.`}
                {' '}
                <span className="denied__where">An owner can grant this under Roles and permissions.</span>
            </span>
        </p>
    );
}
