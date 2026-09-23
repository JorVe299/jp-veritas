import { useState } from 'react';
import Icon from './Icon';
import PermissionLine from './PermissionLine';
import StatusNote from './StatusNote';
import CatalogPicker from './CatalogPicker';
import { createVehicle, deleteVehicle, fetchPlayerVehicles, updateVehicle } from '../api';
import { useCan } from '../lib/useCan';
import { usePlayerResource } from '../lib/usePlayerResource';
import { formatMoney } from '../utils/format';

// 0/1/2 come out of the database that way. The backend supplies a
// stateLabel with every vehicle; this table carries the controls and only
// steps in when the label is missing.
const STATES = [
    { value: 1, label: 'In garage', pill: 'pill--live' },
    { value: 0, label: 'Out', pill: 'pill--off' },
    { value: 2, label: 'Impounded', pill: 'pill--debit' },
];

const stateEntry = (value) => STATES.find((s) => s.value === Number(value));

const modeDetail = (mode) => (mode === 'live'
    ? 'Applied live on the server.'
    : 'The citizen is not connected, so the change went to the database.');

const errorText = (err) => err.response?.data?.error || err.message;

/**
 * A citizen's vehicles. Deliberately two cards instead of one:
 * the record is read and corrected row by row, while adding is an operation
 * of its own with its own model search - in a single card the two would get
 * in each other's way.
 *
 * App.jsx gives the module a key={citizenid}, so the state restarts by
 * itself when the citizen changes.
 */
export default function VehicleManager({ selectedPlayer, onApplied }) {
    const { can } = useCan();
    const canEdit = can('vehicles.edit');

    const citizenid = selectedPlayer?.citizenid;
    const [version, setVersion] = useState(0);
    const [listFeedback, setListFeedback] = useState(null);
    const [addOpen, setAddOpen] = useState(false);

    const res = usePlayerResource(fetchPlayerVehicles, citizenid, version);
    const vehicles = Array.isArray(res.data?.vehicles) ? res.data.vehicles : [];

    const reload = () => setVersion((v) => v + 1);

    // A completed write belongs in the log in the header area, even when it
    // changes nothing on the citizen record itself.
    const report = (mode, text) => onApplied?.({}, { mode, text });

    return (
        <>
            <section className="panel" aria-labelledby="veh-panel-title">
                <header className="panel__head">
                    <Icon name="car" size={18} className="panel__icon" />
                    <div>
                        <h2 className="panel__title" id="veh-panel-title">Vehicles</h2>
                        <p className="panel__hint">{listHint(res, vehicles.length)}</p>
                    </div>
                </header>

                <div className="panel__body">
                    {!canEdit && <PermissionLine what="add, change or delete vehicles" />}

                    {res.status === 'unavailable' && (
                        <StatusNote
                            tone="warn"
                            title="Vehicles are not available in this schema"
                            detail={[res.error, res.hint].filter(Boolean).join(' ')}
                        />
                    )}

                    {res.status === 'error' && (
                        <StatusNote
                            tone="error"
                            title="The vehicles could not be loaded"
                            detail={res.error}
                        />
                    )}

                    {res.status === 'loading' && <p className="field__hint">Loading vehicles…</p>}

                    {res.status === 'ready' && vehicles.length === 0 && (
                        <p className="field__hint">No vehicle is registered to this citizen.</p>
                    )}

                    {vehicles.length > 0 && (
                        <ul className={`lines${vehicles.length > 4 ? ' lines--scroll' : ''}`}>
                            {vehicles.map((vehicle) => (
                                <VehicleRow
                                    key={vehicle.id}
                                    vehicle={vehicle}
                                    canEdit={canEdit}
                                    onFeedback={setListFeedback}
                                    onChanged={reload}
                                    onReport={report}
                                />
                            ))}
                        </ul>
                    )}

                    {listFeedback && (
                        <StatusNote
                            tone={listFeedback.tone}
                            title={listFeedback.title}
                            detail={listFeedback.detail}
                        />
                    )}
                </div>

                {/* Adding has its own model search and used to sit beside
                    the record as a second card - a whole column for an
                    operation that is rarely needed. Behind the button it no
                    longer blocks the record, just as with the inventory. */}
                {res.status !== 'unavailable' && (
                    <footer className="panel__foot">
                        <span className="panel__footinfo">
                            {canEdit ? 'Register another vehicle' : 'Read-only'}
                        </span>
                        <button
                            type="button"
                            className="btn btn--ghost"
                            onClick={() => setAddOpen(true)}
                            disabled={res.status === 'error'}
                        >
                            <Icon name="plus" size={15} />
                            Add vehicle
                        </button>
                    </footer>
                )}
            </section>

            {addOpen && (
                <div className="sheet" role="dialog" aria-modal="true" aria-label="Add vehicle">
                    <button
                        className="sheet__backdrop"
                        type="button"
                        aria-label="Close add vehicle"
                        onClick={() => setAddOpen(false)}
                    />

                    <div className="sheet__panel">
                        <header className="sheet__head">
                            <Icon name="plus" size={20} />
                            <div className="sheet__heading">
                                <h2 className="sheet__title">Add vehicle</h2>
                                <p className="sheet__sub">
                                    Register a vehicle to {selectedPlayer?.name || citizenid}.
                                </p>
                            </div>
                            <button
                                type="button"
                                className="btn btn--ghost btn--sm"
                                onClick={() => setAddOpen(false)}
                            >
                                Close
                            </button>
                        </header>

                        {/* The sheet stays open after adding: whoever enters
                            one vehicle often enters the second right after,
                            and the record behind it is already up to date. */}
                        <div className="sheet__body sheet__body--single">
                            <VehicleAdd
                                citizenid={citizenid}
                                canEdit={canEdit}
                                disabled={res.status === 'error' || !canEdit}
                                onAdded={reload}
                                onReport={report}
                            />
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}

function listHint(res, count) {
    if (res.status === 'loading') return 'Reading the registry';
    if (res.status === 'unavailable') return 'Module unavailable';
    if (res.status === 'error') return 'Registry unknown';
    return count === 1 ? '1 vehicle registered' : `${count} vehicles registered`;
}

/* -------------------------------------------------------------------------
   One row of the record: read, edit, delete.
   ------------------------------------------------------------------------- */

function VehicleRow({ vehicle, canEdit, onFeedback, onChanged, onReport }) {
    const [editing, setEditing] = useState(false);
    const [plate, setPlate] = useState(vehicle.plate ?? '');
    const [garage, setGarage] = useState(vehicle.garage ?? '');
    const [state, setState] = useState(String(vehicle.state ?? 1));
    // Two steps instead of confirm(): the button changes its label and
    // stays there until confirmed or dismissed.
    const [confirming, setConfirming] = useState(false);
    const [busy, setBusy] = useState(false);

    const name = [vehicle.brand, vehicle.label || vehicle.model].filter(Boolean).join(' ');
    const badge = stateEntry(vehicle.state);
    const stateLabel = vehicle.stateLabel || badge?.label || 'Unknown';

    const isDirty = plate !== (vehicle.plate ?? '')
        || garage !== (vehicle.garage ?? '')
        || state !== String(vehicle.state ?? 1);

    const startEdit = () => {
        setPlate(vehicle.plate ?? '');
        setGarage(vehicle.garage ?? '');
        setState(String(vehicle.state ?? 1));
        setEditing(true);
        setConfirming(false);
        onFeedback(null);
    };

    const handleSave = async () => {
        setBusy(true);
        onFeedback(null);
        try {
            const changes = {};
            if (plate !== (vehicle.plate ?? '')) changes.plate = plate.trim();
            if (garage !== (vehicle.garage ?? '')) changes.garage = garage.trim();
            if (state !== String(vehicle.state ?? 1)) changes.state = Number(state);

            const answer = await updateVehicle(vehicle.id, changes);
            const mode = answer.data?.mode === 'live' ? 'live' : 'offline';

            onFeedback({
                tone: 'success',
                title: answer.data?.message || `${name} updated`,
                detail: modeDetail(mode),
            });
            onReport(mode, `Vehicle ${name} changed`);
            setEditing(false);
            onChanged();
        } catch (err) {
            onFeedback({
                tone: 'error',
                title: 'The vehicle could not be changed',
                detail: errorText(err),
            });
        } finally {
            setBusy(false);
        }
    };

    const handleDelete = async () => {
        setBusy(true);
        onFeedback(null);
        try {
            const answer = await deleteVehicle(vehicle.id);
            const mode = answer.data?.mode === 'live' ? 'live' : 'offline';

            onFeedback({
                tone: 'success',
                title: answer.data?.message || `${name} deleted`,
                detail: modeDetail(mode),
            });
            onReport(mode, `Vehicle ${name} deleted`);
            onChanged();
        } catch (err) {
            setConfirming(false);
            onFeedback({
                tone: 'error',
                title: 'The vehicle could not be deleted',
                detail: errorText(err),
            });
        } finally {
            setBusy(false);
        }
    };

    return (
        <li className="line">
            <div className="line__top">
                <span className="line__name">{name || 'Unknown model'}</span>
                {/* The label can be the server's own word for a state. */}
                <span className={`pill pill--fit ${badge?.pill ?? 'pill--unknown'} line__badge`} title={stateLabel}>
                    <span className="u-clip">{stateLabel}</span>
                </span>
            </div>

            <div className="line__meta">
                <span className="u-mono">{vehicle.plate || 'no plate'}</span>
                <span>Garage: {vehicle.garage || 'none'}</span>
                {Number.isFinite(Number(vehicle.fuel)) && <span>Fuel {Math.round(Number(vehicle.fuel))}</span>}
                {Number.isFinite(Number(vehicle.engine)) && <span>Engine {Math.round(Number(vehicle.engine))}</span>}
                {Number.isFinite(Number(vehicle.body)) && <span>Body {Math.round(Number(vehicle.body))}</span>}
            </div>

            {editing && (
                <div className="line__edit">
                    <div className="field">
                        <label className="field__label" htmlFor={`veh-plate-${vehicle.id}`}>Plate</label>
                        <input
                            id={`veh-plate-${vehicle.id}`}
                            className="input u-mono"
                            type="text"
                            autoComplete="off"
                            value={plate}
                            onChange={(e) => setPlate(e.target.value)}
                            disabled={busy}
                        />
                    </div>

                    <div className="field">
                        <label className="field__label" htmlFor={`veh-garage-${vehicle.id}`}>Garage</label>
                        <input
                            id={`veh-garage-${vehicle.id}`}
                            className="input"
                            type="text"
                            autoComplete="off"
                            value={garage}
                            onChange={(e) => setGarage(e.target.value)}
                            disabled={busy}
                        />
                    </div>

                    <div className="field">
                        <label className="field__label" htmlFor={`veh-state-${vehicle.id}`}>Status</label>
                        <select
                            id={`veh-state-${vehicle.id}`}
                            className="select"
                            value={state}
                            onChange={(e) => setState(e.target.value)}
                            disabled={busy}
                        >
                            {STATES.map((s) => (
                                <option key={s.value} value={String(s.value)}>{s.label}</option>
                            ))}
                        </select>
                    </div>
                </div>
            )}

            {confirming && (
                <p className="line__meta">Deleting removes the vehicle from the database for good.</p>
            )}

            <div className="line__actions">
                {editing ? (
                    <>
                        <button
                            type="button"
                            className="btn btn--primary btn--sm"
                            onClick={handleSave}
                            disabled={!isDirty || busy}
                        >
                            {busy ? 'Saving…' : 'Save'}
                        </button>
                        <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            onClick={() => setEditing(false)}
                            disabled={busy}
                        >
                            Cancel
                        </button>
                    </>
                ) : (
                    <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={startEdit}
                        disabled={busy || !canEdit}
                    >
                        Edit
                    </button>
                )}

                {confirming ? (
                    <>
                        <button
                            type="button"
                            className="btn btn--danger btn--sm"
                            onClick={handleDelete}
                            disabled={busy}
                        >
                            {busy ? 'Deleting…' : 'Really delete'}
                        </button>
                        <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            onClick={() => setConfirming(false)}
                            disabled={busy}
                        >
                            Keep
                        </button>
                    </>
                ) : (
                    <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() => { setConfirming(true); onFeedback(null); }}
                        disabled={busy || !canEdit}
                    >
                        Delete
                    </button>
                )}
            </div>
        </li>
    );
}

/* -------------------------------------------------------------------------
   Second card: add a vehicle.
   ------------------------------------------------------------------------- */

function VehicleAdd({ citizenid, canEdit, disabled, onAdded, onReport }) {
    const [model, setModel] = useState(null); // { key, name, brand, price }
    const [plate, setPlate] = useState('');
    const [garage, setGarage] = useState('');
    const [state, setState] = useState('1');
    const [saving, setSaving] = useState(false);
    const [feedback, setFeedback] = useState(null);

    const canSave = Boolean(model) && !saving && !disabled;

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!canSave) return;

        setSaving(true);
        setFeedback(null);
        try {
            const answer = await createVehicle(citizenid, {
                model: model.key,
                plate: plate.trim() || undefined,
                garage: garage.trim() || undefined,
                state: Number(state),
            });
            const mode = answer.data?.mode === 'live' ? 'live' : 'offline';
            const name = [model.brand, model.name].filter(Boolean).join(' ') || model.key;

            setFeedback({
                tone: 'success',
                title: answer.data?.message || `${name} registered`,
                detail: `${modeDetail(mode)}${plate.trim() ? '' : ' The plate was generated.'}`,
            });
            setPlate('');
            setGarage('');
            onReport(mode, `Vehicle ${name} created`);
            onAdded();
        } catch (err) {
            setFeedback({
                tone: 'error',
                title: 'The vehicle could not be created',
                detail: errorText(err),
            });
        } finally {
            setSaving(false);
        }
    };

    return (
        <form className="panel__form" onSubmit={handleSubmit}>
            <div className="panel__body">
                {!canEdit && <PermissionLine what="register vehicles" />}

                <CatalogPicker
                    id="veh-model"
                    kind="vehicles"
                    label="Model"
                    placeholder="Search by model or manufacturer"
                    selected={model?.key ?? ''}
                    selectedLabel={model ? [model.brand, model.name].filter(Boolean).join(' ') : ''}
                    onSelect={(entry) => { setModel(entry); setFeedback(null); }}
                    disabled={saving || disabled}
                    title={(entry) => [entry.brand, entry.name].filter(Boolean).join(' ') || entry.key}
                    meta={(entry) => (Number.isFinite(Number(entry.price)) ? formatMoney(entry.price) : '')}
                />

                <div className="panel__row">
                    <div className="field">
                        <label className="field__label" htmlFor="veh-add-plate">Plate</label>
                        <input
                            id="veh-add-plate"
                            className="input u-mono"
                            type="text"
                            autoComplete="off"
                            placeholder="generated"
                            value={plate}
                            onChange={(e) => { setPlate(e.target.value); setFeedback(null); }}
                            disabled={saving || disabled}
                        />
                        <span className="field__hint">Leave empty and the server assigns one.</span>
                    </div>

                    <div className="field">
                        <label className="field__label" htmlFor="veh-add-garage">Garage</label>
                        <input
                            id="veh-add-garage"
                            className="input"
                            type="text"
                            autoComplete="off"
                            placeholder="Default"
                            value={garage}
                            onChange={(e) => { setGarage(e.target.value); setFeedback(null); }}
                            disabled={saving || disabled}
                        />
                    </div>
                </div>

                <div className="field">
                    <label className="field__label" htmlFor="veh-add-state">Status</label>
                    <select
                        id="veh-add-state"
                        className="select"
                        value={state}
                        onChange={(e) => { setState(e.target.value); setFeedback(null); }}
                        disabled={saving || disabled}
                    >
                        {STATES.map((s) => (
                            <option key={s.value} value={String(s.value)}>{s.label}</option>
                        ))}
                    </select>
                </div>

                {feedback && (
                    <StatusNote tone={feedback.tone} title={feedback.title} detail={feedback.detail} />
                )}
            </div>

            <footer className="panel__foot">
                <span className="panel__footinfo">
                    {model ? (model.name || model.key) : 'No model selected'}
                </span>
                <button type="submit" className="btn btn--primary" disabled={!canSave}>
                    {saving ? 'Creating…' : 'Create vehicle'}
                </button>
            </footer>
        </form>
    );
}
