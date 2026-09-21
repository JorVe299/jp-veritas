import Icon from './Icon';
import PortalNotice from './PortalNotice';
import { usePortalResource } from '../lib/usePortal';
import { fetchMyVehicles } from '../api';
import { shown } from '../lib/portalText';

// The same three states the panel names, so a player and an admin are
// talking about the same thing. The server's own stateLabel takes
// precedence over all of it; this is only the fallback and the colour.
const STATES = {
    0: { label: 'Out', pill: 'pill--off' },
    1: { label: 'In garage', pill: 'pill--live' },
    2: { label: 'Impounded', pill: 'pill--debit' },
};

/**
 * The vehicles on a character.
 *
 * `available: false` is the case that must not be got wrong. It means this
 * server's database has no table of owned vehicles at all - so an empty
 * list would tell a player they own nothing, which is a different and
 * possibly false statement. It is named instead.
 */
export default function PortalVehicles({ citizenid }) {
    const state = usePortalResource(fetchMyVehicles, citizenid);

    const vehicles = Array.isArray(state.data?.vehicles) ? state.data.vehicles : [];
    // Only an explicit false counts as "no such table". A missing field is
    // not a denial, and reading it as one would hide a real garage.
    const unsupported = state.status === 'ready' && state.data?.available === false;

    return (
        <section className="idpanel">
            <header className="idpanel__head">
                <Icon name="car" size={18} className="idpanel__icon" />
                <h2 className="idpanel__title">Vehicles</h2>
                {state.status === 'ready' && !unsupported && (
                    <span className="idpanel__count u-mono">{vehicles.length}</span>
                )}
            </header>

            <div className="idpanel__body">
                {state.status === 'loading' && (
                    <p className="idnone" role="status">Loading…</p>
                )}

                {state.status === 'failed' && (
                    <PortalNotice
                        code={state.code}
                        error={state.error}
                        hint={state.hint}
                        onRetry={state.reload}
                    />
                )}

                {unsupported && (
                    <p className="idnone">
                        This server does not keep owned vehicles in a table Veritas ID can
                        read, so none can be listed. That is not the same as owning none.
                    </p>
                )}

                {state.status === 'ready' && !unsupported && vehicles.length === 0 && (
                    <p className="idnone">No vehicles are registered to this character.</p>
                )}

                {state.status === 'ready' && !unsupported && vehicles.length > 0 && (
                    <ul className="idrows">
                        {vehicles.map((vehicle, index) => {
                            const known = STATES[Number(vehicle?.state)];
                            const label = vehicle?.stateLabel || known?.label || 'State unknown';

                            return (
                                <li key={`${vehicle?.plate ?? 'plate'}-${index}`} className="idrow">
                                    <span className="idrow__main">
                                        <span className="idrow__name">{shown(vehicle?.model)}</span>
                                        <span className="idrow__meta">
                                            <span className="u-mono">{shown(vehicle?.plate)}</span>
                                            <span className="idrow__sep" aria-hidden="true">·</span>
                                            {vehicle?.garage ? `Garage ${vehicle.garage}` : 'No garage recorded'}
                                        </span>
                                    </span>

                                    <span className={`pill ${known?.pill ?? 'pill--unknown'}`}>{label}</span>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>
        </section>
    );
}
