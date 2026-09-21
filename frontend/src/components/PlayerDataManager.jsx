import { useState } from 'react';
import Icon from './Icon';
import PermissionLine from './PermissionLine';
import StatusNote from './StatusNote';
import {
    fetchPlayerMetadata,
    updatePlayerCharinfo,
    updatePlayerLicense,
    updatePlayerStatus,
} from '../api';
import { useCan } from '../lib/useCan';
import { usePlayerResource } from '../lib/usePlayerResource';

const LICENCES = [
    { key: 'driver', label: 'Driver licence' },
    { key: 'business', label: 'Business licence' },
    { key: 'weapon', label: 'Weapon licence' },
    { key: 'pilot', label: 'Pilot licence' },
];

// The four needs share the 0-100 scale; jail time has one of its own and
// therefore does not belong on the same slider.
const GAUGES = [
    { key: 'hunger', label: 'Hunger' },
    { key: 'thirst', label: 'Thirst' },
    { key: 'stress', label: 'Stress' },
    { key: 'armor', label: 'Armor' },
];

const JAIL_MAX = 10000;

const modeDetail = (mode) => (mode === 'live'
    ? 'Applied live on the server.'
    : 'The citizen is not connected, so the change went to the database.');

const errorText = (err) => err.response?.data?.error || err.message;

/**
 * Licenses, status values and character data.
 *
 * Three cards instead of one: the licenses switch immediately, the status
 * values are saved as a block, and the character data is a form with a
 * consequence of its own (the change only takes effect on the next login).
 * In one card three different saving models would have sat side by side.
 *
 * The two data-driven cards are only mounted once the metadata is there,
 * and they get a key from the load state - that way their state initializes
 * from the data without having to be synchronized afterwards in an
 * effect.
 *
 * `show` selects which of the three cards are rendered. By subject they do
 * not actually belong together: licenses and character data describe who
 * someone is, while status describes how they are doing right now. They
 * therefore sit in different sections of the module wall, but share this
 * one data source.
 */
export default function PlayerDataManager({ selectedPlayer, onApplied, show = ['licences', 'condition', 'charinfo'] }) {
    const citizenid = selectedPlayer?.citizenid;
    const wants = (part) => show.includes(part);

    /* The special case among the modules: three cards, three permissions.
       Licenses and status both read /metadata and need metadata.view for
       that - without it they are not mounted at all, otherwise their load
       call would run into a 403. The character data loads nothing extra:
       it already sits in the selected citizen. That is why its card stays
       even without metadata.view. */
    const { can } = useCan();
    const canViewMeta = can('metadata.view');
    const canEditLicences = can('licenses.edit');
    const canEditStatus = can('status.edit');
    const canEditCharinfo = can('charinfo.edit');

    // Without the read permission nothing loads: no citizenid, no call.
    const res = usePlayerResource(fetchPlayerMetadata, canViewMeta ? citizenid : null);
    const data = res.data || {};
    const ready = res.status === 'ready';

    const report = (mode, text) => onApplied?.({}, { mode, text });

    return (
        <>
            {canViewMeta && wants('licences') && (
                <section className="panel" aria-labelledby="lic-panel-title">
                    <header className="panel__head">
                        <Icon name="id" size={18} className="panel__icon" />
                        <div>
                            <h2 className="panel__title" id="lic-panel-title">Licences</h2>
                            <p className="panel__hint">
                                {canEditLicences ? 'Each toggle saves immediately' : 'What this citizen holds'}
                            </p>
                        </div>
                    </header>

                    <div className="panel__body">
                        {!canEditLicences && <PermissionLine what="grant or revoke licences" />}
                        <LoadState res={res} what="Licences" />
                        {ready && (
                            <LicenceBoard
                                key={`lic-${citizenid}`}
                                citizenid={citizenid}
                                licences={data.licences || {}}
                                canEdit={canEditLicences}
                                onReport={report}
                            />
                        )}
                    </div>
                </section>
            )}

            {canViewMeta && wants('condition') && (
                <section className="panel" aria-labelledby="status-panel-title">
                    <header className="panel__head">
                        <Icon name="pulse" size={18} className="panel__icon" />
                        <div>
                            <h2 className="panel__title" id="status-panel-title">Condition</h2>
                            <p className="panel__hint">Needs, armor and jail time</p>
                        </div>
                    </header>

                    {ready ? (
                        <StatusBoard
                            key={`status-${citizenid}`}
                            citizenid={citizenid}
                            meta={data}
                            canEdit={canEditStatus}
                            onReport={report}
                        />
                    ) : (
                        <div className="panel__body">
                            <LoadState res={res} what="Condition values" />
                        </div>
                    )}
                </section>
            )}

            {wants('charinfo') && (
                <CharinfoBoard
                    citizenid={citizenid}
                    charinfo={selectedPlayer?.charinfo || {}}
                    canEdit={canEditCharinfo}
                    onApplied={onApplied}
                />
            )}
        </>
    );
}

// Loading, errors and "does not exist in this schema" look the same in all
// three cards and therefore stand here only once.
// `what` is always a plural so that the sentences below work out.
function LoadState({ res, what }) {
    if (res.status === 'loading') return <p className="field__hint">Loading {what.toLowerCase()}…</p>;

    if (res.status === 'unavailable') {
        return (
            <StatusNote
                tone="warn"
                title={`${what} are not available in this schema`}
                detail={[res.error, res.hint].filter(Boolean).join(' ')}
            />
        );
    }

    if (res.status === 'error') {
        return (
            <StatusNote
                tone="error"
                title={`${what} could not be loaded`}
                detail={res.error}
            />
        );
    }

    return null;
}

/* -------------------------------------------------------------------------
   Licenses: four toggles that write individually.
   ------------------------------------------------------------------------- */

function LicenceBoard({ citizenid, licences, canEdit, onReport }) {
    const [values, setValues] = useState(() => {
        const start = {};
        LICENCES.forEach(({ key }) => { start[key] = Boolean(licences[key]); });
        return start;
    });
    const [pending, setPending] = useState(null);
    const [feedback, setFeedback] = useState(null);

    const toggle = async (key, label, next) => {
        if (!canEdit || values[key] === next || pending) return;

        setPending(key);
        setFeedback(null);
        try {
            const answer = await updatePlayerLicense(citizenid, key, next);
            const mode = answer.data?.mode === 'live' ? 'live' : 'offline';

            setValues((prev) => ({ ...prev, [key]: next }));
            setFeedback({
                tone: 'success',
                title: answer.data?.message || `${label} ${next ? 'granted' : 'revoked'}`,
                detail: modeDetail(mode),
            });
            onReport(mode, `${label} ${next ? 'granted' : 'revoked'}`);
        } catch (err) {
            setFeedback({
                tone: 'error',
                title: `${label} could not be changed`,
                detail: errorText(err),
            });
        } finally {
            setPending(null);
        }
    };

    return (
        <>
            <div className="panel__row">
                {LICENCES.map(({ key, label }) => {
                    const held = values[key];
                    const busy = pending === key;
                    return (
                        <div className="field" key={key}>
                            <span className="field__label" id={`lic-${key}-label`}>{label}</span>
                            <div className="segment" role="group" aria-labelledby={`lic-${key}-label`}>
                                <button
                                    type="button"
                                    className="segment__btn"
                                    aria-pressed={held}
                                    onClick={() => toggle(key, label, true)}
                                    disabled={Boolean(pending) || !canEdit}
                                >
                                    <Icon name="check" size={14} />
                                    Granted
                                </button>
                                <button
                                    type="button"
                                    className="segment__btn segment__btn--debit"
                                    aria-pressed={!held}
                                    onClick={() => toggle(key, label, false)}
                                    disabled={Boolean(pending) || !canEdit}
                                >
                                    <Icon name="cross" size={14} />
                                    Revoked
                                </button>
                            </div>
                            {busy && <span className="field__hint">Saving…</span>}
                        </div>
                    );
                })}
            </div>

            {feedback && (
                <StatusNote tone={feedback.tone} title={feedback.title} detail={feedback.detail} />
            )}
        </>
    );
}

/* -------------------------------------------------------------------------
   Status: four sliders on 0-100 plus jail time.
   ------------------------------------------------------------------------- */

function StatusBoard({ citizenid, meta, canEdit, onReport }) {
    const status = meta.status || {};
    const start = () => {
        const initial = {};
        GAUGES.forEach(({ key }) => { initial[key] = clampText(status[key], 100); });
        initial.jailtime = clampText(status.jailtime, JAIL_MAX);
        return initial;
    };

    // The baseline is carried along after saving instead of reloading the
    // card: a remount would take away the feedback that has only just
    // confirmed the operation.
    const [base, setBase] = useState(start);
    const [values, setValues] = useState(start);
    const [saving, setSaving] = useState(false);
    const [feedback, setFeedback] = useState(null);

    const changed = Object.keys(base).filter((key) => values[key] !== base[key]);
    const allValid = Object.entries(values).every(([key, value]) => {
        const max = key === 'jailtime' ? JAIL_MAX : 100;
        const n = Number(value);
        return value !== '' && Number.isFinite(n) && n >= 0 && n <= max;
    });
    const canSave = changed.length > 0 && allValid && !saving && canEdit;

    const set = (key, value) => {
        setValues((prev) => ({ ...prev, [key]: value }));
        setFeedback(null);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!canSave) return;

        setSaving(true);
        setFeedback(null);
        try {
            // Send only what actually moved: the backend takes each field
            // on its own.
            const changes = {};
            changed.forEach((key) => { changes[key] = Number(values[key]); });

            const answer = await updatePlayerStatus(citizenid, changes);
            const mode = answer.data?.mode === 'live' ? 'live' : 'offline';
            const text = changed.map((key) => `${gaugeLabel(key)} ${values[key]}`).join(', ');

            setFeedback({
                tone: 'success',
                title: answer.data?.message || 'Condition saved',
                detail: modeDetail(mode),
            });
            onReport(mode, `Condition: ${text}`);
            setBase({ ...values });
        } catch (err) {
            setFeedback({
                tone: 'error',
                title: 'The condition could not be saved',
                detail: errorText(err),
            });
        } finally {
            setSaving(false);
        }
    };

    const flags = [
        meta.isdead ? 'dead' : null,
        meta.ishandcuffed ? 'handcuffed' : null,
        meta.bloodtype ? `Blood type ${meta.bloodtype}` : null,
        meta.callsign ? `Callsign ${meta.callsign}` : null,
    ].filter(Boolean);

    return (
        <form className="panel__form" onSubmit={handleSubmit}>
            <div className="panel__body">
                {!canEdit && <PermissionLine what="change condition values" />}

                {flags.length > 0 && (
                    <div className="line__meta">
                        {flags.map((flag) => <span key={flag}>{flag}</span>)}
                    </div>
                )}

                {GAUGES.map(({ key, label }) => (
                    <Gauge
                        key={key}
                        id={`status-${key}`}
                        label={label}
                        max={100}
                        value={values[key]}
                        onChange={(value) => set(key, value)}
                        disabled={saving || !canEdit}
                    />
                ))}

                <Gauge
                    id="status-jailtime"
                    label="Jail time"
                    max={JAIL_MAX}
                    value={values.jailtime}
                    onChange={(value) => set('jailtime', value)}
                    disabled={saving || !canEdit}
                />

                {feedback && (
                    <StatusNote tone={feedback.tone} title={feedback.title} detail={feedback.detail} />
                )}
            </div>

            <footer className="panel__foot">
                <span className="panel__footinfo">
                    {changed.length === 0
                        ? 'No change'
                        : `${changed.length} ${changed.length === 1 ? 'value' : 'values'} changed`}
                </span>
                <button type="submit" className="btn btn--primary" disabled={!canSave}>
                    {saving ? 'Saving…' : 'Save condition'}
                </button>
            </footer>
        </form>
    );
}

// Slider and number field show the same value: the slider is for estimating,
// the field for setting it exactly.
function Gauge({ id, label, value, onChange, max, disabled }) {
    return (
        <div className="field">
            <label className="field__label" htmlFor={id}>{label}</label>
            <div className="gauge">
                <input
                    className="range"
                    type="range"
                    min="0"
                    max={max}
                    step="1"
                    value={Number.isFinite(Number(value)) && value !== '' ? Number(value) : 0}
                    onChange={(e) => onChange(e.target.value)}
                    disabled={disabled}
                    aria-label={`Adjust ${label}`}
                />
                <input
                    id={id}
                    className="input u-mono"
                    type="number"
                    min="0"
                    max={max}
                    step="1"
                    inputMode="numeric"
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    disabled={disabled}
                />
            </div>
            <span className="field__hint">{label} from 0 to {max}</span>
        </div>
    );
}

function clampText(raw, max) {
    const n = Number(raw);
    if (!Number.isFinite(n)) return '0';
    return String(Math.min(Math.max(Math.round(n), 0), max));
}

function gaugeLabel(key) {
    if (key === 'jailtime') return 'Jail time';
    return GAUGES.find((g) => g.key === key)?.label ?? key;
}

/* -------------------------------------------------------------------------
   Character data. The source is the selected citizen, not /metadata -
   which is why the key={citizenid} from App.jsx is enough here.
   ------------------------------------------------------------------------- */

function CharinfoBoard({ citizenid, charinfo, canEdit, onApplied }) {
    const [firstname, setFirstname] = useState(charinfo.firstname ?? '');
    const [lastname, setLastname] = useState(charinfo.lastname ?? '');
    const [phone, setPhone] = useState(charinfo.phone ?? '');
    const [saving, setSaving] = useState(false);
    const [feedback, setFeedback] = useState(null);

    const isDirty = firstname !== (charinfo.firstname ?? '')
        || lastname !== (charinfo.lastname ?? '')
        || phone !== (charinfo.phone ?? '');
    const canSave = isDirty && firstname.trim() !== '' && lastname.trim() !== '' && !saving && canEdit;

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!canSave) return;

        setSaving(true);
        setFeedback(null);
        try {
            const changes = {};
            if (firstname !== (charinfo.firstname ?? '')) changes.firstname = firstname.trim();
            if (lastname !== (charinfo.lastname ?? '')) changes.lastname = lastname.trim();
            if (phone !== (charinfo.phone ?? '')) changes.phone = phone.trim();

            const answer = await updatePlayerCharinfo(citizenid, changes);
            const mode = answer.data?.mode === 'live' ? 'live' : 'offline';
            const name = `${firstname.trim()} ${lastname.trim()}`.trim();

            setFeedback({
                tone: answer.data?.hint ? 'warn' : 'success',
                title: answer.data?.message || 'Character details saved',
                // The backend's hint is the actual message here: the change
                // only takes effect on the next login.
                detail: [modeDetail(mode), answer.data?.hint].filter(Boolean).join(' '),
            });

            onApplied?.(
                { name, charinfo: { ...charinfo, ...changes } },
                { mode, text: `Character details changed: ${name}` },
            );
        } catch (err) {
            setFeedback({
                tone: 'error',
                title: 'The character details could not be saved',
                detail: errorText(err),
            });
        } finally {
            setSaving(false);
        }
    };

    return (
        <section className="panel" aria-labelledby="char-panel-title">
            <header className="panel__head">
                <Icon name="id" size={18} className="panel__icon" />
                <div>
                    <h2 className="panel__title" id="char-panel-title">Character details</h2>
                    <p className="panel__hint">Name and phone number</p>
                </div>
            </header>

            <form className="panel__form" onSubmit={handleSubmit}>
                <div className="panel__body">
                    {!canEdit && <PermissionLine what="rename this citizen or change their phone number" />}

                    <div className="panel__row">
                        <div className="field">
                            <label className="field__label" htmlFor="char-firstname">First name</label>
                            <input
                                id="char-firstname"
                                className="input"
                                type="text"
                                autoComplete="off"
                                value={firstname}
                                onChange={(e) => { setFirstname(e.target.value); setFeedback(null); }}
                                disabled={saving || !canEdit}
                            />
                        </div>

                        <div className="field">
                            <label className="field__label" htmlFor="char-lastname">Last name</label>
                            <input
                                id="char-lastname"
                                className="input"
                                type="text"
                                autoComplete="off"
                                value={lastname}
                                onChange={(e) => { setLastname(e.target.value); setFeedback(null); }}
                                disabled={saving || !canEdit}
                            />
                        </div>
                    </div>

                    <div className="field">
                        <label className="field__label" htmlFor="char-phone">Phone</label>
                        <input
                            id="char-phone"
                            className="input u-mono"
                            type="text"
                            autoComplete="off"
                            value={phone}
                            onChange={(e) => { setPhone(e.target.value); setFeedback(null); }}
                            disabled={saving || !canEdit}
                        />
                    </div>

                    {isDirty && firstname.trim() !== '' && lastname.trim() !== '' && (
                        <div className="preview">
                            <span className="preview__label u-caps">New name</span>
                            <span className="preview__value">{`${firstname.trim()} ${lastname.trim()}`}</span>
                        </div>
                    )}

                    {feedback && (
                        <StatusNote tone={feedback.tone} title={feedback.title} detail={feedback.detail} />
                    )}
                </div>

                <footer className="panel__foot">
                    <span className="panel__footinfo">
                        {isDirty ? 'Unsaved change' : 'No change'}
                    </span>
                    <button type="submit" className="btn btn--primary" disabled={!canSave}>
                        {saving ? 'Saving…' : 'Save character details'}
                    </button>
                </footer>
            </form>
        </section>
    );
}
