import Icon from './Icon';
import { formatDateTime } from '../utils/format';
import { DASH } from '../lib/portalText';

/**
 * Bans in force, at the top of every Veritas ID page; nothing at all otherwise
 * Server's active flag only; loading, failed and partial states stay with PortalBans
 */
export default function PortalBanAlert({ state }) {
    if (state?.status !== 'ready') return null;

    const bans = Array.isArray(state.data?.bans) ? state.data.bans : [];
    const standing = bans.filter((ban) => ban?.active === true);
    if (standing.length === 0) return null;

    return (
        <section className="idalert" role="alert" aria-labelledby="id-alert-title">
            <Icon name="ban" size={22} className="idalert__icon" />

            <div className="idalert__body">
                <h2 className="idalert__title" id="id-alert-title">
                    {standing.length === 1
                        ? 'You are banned from this server'
                        : `${standing.length} bans are in force on your account`}
                </h2>

                <ul className="idalert__list">
                    {standing.map((ban, index) => (
                        <li key={`${ban?.source ?? 'ban'}-${ban?.id ?? index}`} className="idalert__item">
                            <span className="idalert__reason">
                                {typeof ban?.reason === 'string' && ban.reason.trim()
                                    ? ban.reason.trim()
                                    : 'No reason was recorded'}
                            </span>
                            <span className="idalert__meta">
                                <span>{term(ban)}</span>
                                {ban?.reference && (
                                    <span>
                                        Reference <span className="u-mono idalert__ref">{ban.reference}</span>
                                    </span>
                                )}
                            </span>
                        </li>
                    ))}
                </ul>

                <p className="idalert__hint">
                    Applies to every character on this account. Quote the reference to the server staff.
                </p>
            </div>
        </section>
    );
}

function term(ban) {
    if (ban?.permanent === true) return 'No end date';
    const until = formatDateTime(ban?.expiresAt);
    return until === DASH ? 'End date not recorded' : `Until ${until}`;
}
