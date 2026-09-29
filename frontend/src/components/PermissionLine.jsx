import Icon from './Icon';
import { useCan } from '../lib/useCan';

/**
 * Why a card is read-only; once per card, not per button
 * `what`: verb and object, e.g. "change balances"
 */
export default function PermissionLine({ what }) {
    const { roleLabel } = useCan();

    return (
        <p className="denied">
            <Icon name="info" size={15} className="denied__icon" />
            <span>
                {/* Unknown role label: not named, never invented */}
                {roleLabel
                    ? `Your role (${roleLabel}) cannot ${what}.`
                    : `You are not allowed to ${what}.`}
                {' '}
                <span className="denied__where">An owner can grant this under Roles and permissions.</span>
            </span>
        </p>
    );
}
