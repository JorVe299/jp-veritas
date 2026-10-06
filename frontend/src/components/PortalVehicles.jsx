import Icon from './Icon';
import PortalNotice from './PortalNotice';
import { usePortalResource } from '../lib/usePortal';
import { fetchMyVehicles } from '../api';
import { shown } from '../lib/portalText';

// Same labels as the panel; the server's stateLabel wins, this is only fallback and colour
const STATES = {
    0: { label: 'Out', pill: 'pill--off' },
    1: { label: 'In garage', pill: 'pill--live' },
    2: { label: 'Impounded', pill: 'pill--debit' },
};

/** `available: false` (no vehicle table on this server) is named, never shown as owning none */
export default function PortalVehicles({ citizenid }) {
    const state = usePortalResource(fetchMyVehicles, citizenid);

    const vehicles = Array.isArray(state.data?.vehicles) ? state.data.vehicles : [];
    // Only an explicit false counts as unavailable; a missing field is not a denial
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
                        Vehicles cannot be read on this server.
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

                                    {/* The server's own label may run long */}
                                    <span className={`pill pill--fit ${known?.pill ?? 'pill--unknown'}`} title={label}>
                                        <span className="u-clip">{label}</span>
                                    </span>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>
        </section>
    );
}
