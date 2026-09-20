import { useState } from 'react';
import Icon from './Icon';
import StatusNote from './StatusNote';
import {
    fetchPlayerMetadata,
    updatePlayerCharinfo,
    updatePlayerLicense,
    updatePlayerStatus,
} from '../api';
import { usePlayerResource } from '../lib/usePlayerResource';

const LICENCES = [
    { key: 'driver', label: 'Driver licence' },
    { key: 'business', label: 'Business licence' },
    { key: 'weapon', label: 'Weapon licence' },
    { key: 'pilot', label: 'Pilot licence' },
];

// Die vier Bedürfnisse teilen sich die Skala 0-100, die Haftzeit hat eine
// eigene und gehoert deshalb nicht an denselben Regler.
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
 * Lizenzen, Zustandswerte und Charakterdaten.
 *
 * Drei Karten statt einer: die Lizenzen schalten sofort, die Statuswerte
 * werden im Block gespeichert, und die Charakterdaten sind ein Formular mit
 * eigener Folge (die Aenderung greift erst beim naechsten Login). In einer
 * Karte haetten drei verschiedene Speicherlogiken nebeneinander gestanden.
 *
 * Die beiden datengetriebenen Karten werden erst gemountet, wenn die
 * Metadaten da sind, und bekommen ein key aus dem Ladestand - damit
 * initialisiert ihr State sich aus den Daten, ohne ihn in einem Effect
 * nachtraeglich zu synchronisieren.
 */
export default function PlayerDataManager({ selectedPlayer, onApplied }) {
    const citizenid = selectedPlayer?.citizenid;

    const res = usePlayerResource(fetchPlayerMetadata, citizenid);
    const data = res.data || {};
    const ready = res.status === 'ready';

    const report = (mode, text) => onApplied?.({}, { mode, text });

    return (
        <>
            <section className="panel" aria-labelledby="lic-panel-title">
                <header className="panel__head">
                    <Icon name="id" size={18} className="panel__icon" />
                    <div>
                        <h2 className="panel__title" id="lic-panel-title">Licences</h2>
                        <p className="panel__hint">Each toggle saves immediately</p>
                    </div>
                </header>

                <div className="panel__body">
                    <LoadState res={res} what="Licences" />
                    {ready && (
                        <LicenceBoard
                            key={`lic-${citizenid}`}
                            citizenid={citizenid}
                            licences={data.licences || {}}
                            onReport={report}
                        />
                    )}
                </div>
            </section>

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
                        onReport={report}
                    />
                ) : (
                    <div className="panel__body">
                        <LoadState res={res} what="Condition values" />
                    </div>
                )}
            </section>

            <CharinfoBoard
                citizenid={citizenid}
                charinfo={selectedPlayer?.charinfo || {}}
                onApplied={onApplied}
            />
        </>
    );
}

// Laden, Fehler und "gibt es in diesem Schema nicht" sehen in allen drei
// Karten gleich aus und stehen deshalb nur einmal hier.
// `what` ist immer eine Mehrzahl, damit die Saetze unten aufgehen.
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
   Lizenzen: vier Umschalter, die einzeln schreiben.
   ------------------------------------------------------------------------- */

function LicenceBoard({ citizenid, licences, onReport }) {
    const [values, setValues] = useState(() => {
        const start = {};
        LICENCES.forEach(({ key }) => { start[key] = Boolean(licences[key]); });
        return start;
    });
    const [pending, setPending] = useState(null);
    const [feedback, setFeedback] = useState(null);

    const toggle = async (key, label, next) => {
        if (values[key] === next || pending) return;

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
                                    disabled={Boolean(pending)}
                                >
                                    <Icon name="check" size={14} />
                                    Granted
                                </button>
                                <button
                                    type="button"
                                    className="segment__btn segment__btn--debit"
                                    aria-pressed={!held}
                                    onClick={() => toggle(key, label, false)}
                                    disabled={Boolean(pending)}
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
   Zustand: vier Regler auf 0-100 plus Haftzeit.
   ------------------------------------------------------------------------- */

function StatusBoard({ citizenid, meta, onReport }) {
    const status = meta.status || {};
    const start = () => {
        const initial = {};
        GAUGES.forEach(({ key }) => { initial[key] = clampText(status[key], 100); });
        initial.jailtime = clampText(status.jailtime, JAIL_MAX);
        return initial;
    };

    // Der Ausgangspunkt wird nach dem Speichern mitgezogen, statt die Karte
    // neu zu laden: ein Remount wuerde die Rueckmeldung mitnehmen, die den
    // Vorgang gerade erst bestaetigt hat.
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
    const canSave = changed.length > 0 && allValid && !saving;

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
            // Nur schicken, was sich tatsaechlich bewegt hat: das Backend
            // nimmt jedes Feld einzeln entgegen.
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
                        disabled={saving}
                    />
                ))}

                <Gauge
                    id="status-jailtime"
                    label="Jail time"
                    max={JAIL_MAX}
                    value={values.jailtime}
                    onChange={(value) => set('jailtime', value)}
                    disabled={saving}
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

// Regler und Zahlenfeld zeigen denselben Wert: der Regler ist zum Schaetzen
// da, das Feld zum genauen Setzen.
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
   Charakterdaten. Quelle ist der ausgewaehlte Citizen, nicht /metadata -
   deshalb reicht hier das key={citizenid} aus App.jsx.
   ------------------------------------------------------------------------- */

function CharinfoBoard({ citizenid, charinfo, onApplied }) {
    const [firstname, setFirstname] = useState(charinfo.firstname ?? '');
    const [lastname, setLastname] = useState(charinfo.lastname ?? '');
    const [phone, setPhone] = useState(charinfo.phone ?? '');
    const [saving, setSaving] = useState(false);
    const [feedback, setFeedback] = useState(null);

    const isDirty = firstname !== (charinfo.firstname ?? '')
        || lastname !== (charinfo.lastname ?? '')
        || phone !== (charinfo.phone ?? '');
    const canSave = isDirty && firstname.trim() !== '' && lastname.trim() !== '' && !saving;

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
                // Der Hinweis des Backends ist hier die eigentliche Nachricht:
                // die Aenderung greift erst beim naechsten Login.
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
                                disabled={saving}
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
                                disabled={saving}
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
                            disabled={saving}
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
