import { useState } from 'react';
import BanLine from './BanLine';
import Icon from './Icon';
import PermissionLine from './PermissionLine';
import StatusNote from './StatusNote';
import { banPlayer, fetchPlayerBans } from '../api';
import { useCan } from '../lib/useCan';
import { usePlayerResource } from '../lib/usePlayerResource';
import { failureNote, successNote } from '../lib/writeFeedback';
import { formatDateTime } from '../utils/format';

const DAY_MS = 86400000;
const MAX_DAYS = 3650;
const REASON_MIN = 3;
const REASON_MAX = 255;

/**
 * A citizen's ban record (database rows on their license/Discord ID only) and a new-ban form
 * Two presses to ban, no confirm(); txAdmin's record is only in the server-wide list
 * Workspace keys this by citizenid: state resets on a citizen change
 */
export default function BanManager({ selectedPlayer, onApplied, onShowServerBans }) {
    const { can } = useCan();
    const canEdit = can('bans.edit');

    const citizenid = selectedPlayer?.citizenid;
    const [version, setVersion] = useState(0);
    const [feedback, setFeedback] = useState(null);

    const [reason, setReason] = useState('');
    const [duration, setDuration] = useState('permanent'); // 'permanent' | 'period'
    const [days, setDays] = useState('7');
    const [confirming, setConfirming] = useState(false);
    const [saving, setSaving] = useState(false);

    const res = usePlayerResource(fetchPlayerBans, citizenid, version);
    const bans = Array.isArray(res.data?.bans) ? res.data.bans : [];
    const identity = res.data?.identity || {};
    const activeCount = Number.isFinite(Number(res.data?.active))
        ? Number(res.data.active)
        : bans.filter((b) => b.active).length;

    const reload = () => setVersion((v) => v + 1);
    const report = (mode, text) => onApplied?.({}, { mode, text });

    // No license and no Discord ID: nothing to ban (backend: 409); said before any typing
    const identified = Boolean(identity.license || identity.discord);
    const permanent = duration === 'permanent';
    const dayCount = Number.parseInt(days, 10);
    const daysValid = permanent || (Number.isInteger(dayCount) && dayCount >= 1 && dayCount <= MAX_DAYS);
    const trimmedReason = reason.trim();
    const reasonValid = trimmedReason.length >= REASON_MIN && trimmedReason.length <= REASON_MAX;

    // Every cause of blocked has its own notice above: the grey-out is never unexplained
    const blocked = !canEdit || res.status === 'unavailable' || res.status === 'error'
        || (res.status === 'ready' && !identified);
    const canSubmit = reasonValid && daysValid && !saving && !blocked && Boolean(citizenid);

    const lifts = permanent || !daysValid
        ? null
        : formatDateTime(Date.now() + dayCount * DAY_MS);

    const change = (setter) => (value) => {
        setter(value);
        setConfirming(false);
        setFeedback(null);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!canSubmit) return;

        if (!confirming) {
            setConfirming(true);
            setFeedback(null);
            return;
        }

        setSaving(true);
        setFeedback(null);
        try {
            const answer = await banPlayer(citizenid, {
                reason: trimmedReason,
                days: permanent ? 0 : dayCount,
            });

            const kicked = answer.data?.kicked === true;
            const span = permanent ? 'Permanent ban' : `Ban for ${dayCount} day${dayCount === 1 ? '' : 's'}`;

            setFeedback(successNote(
                answer,
                `${span} recorded`,
                kicked ? 'Kicked from the server.' : undefined,
            ));
            report(kicked ? 'live' : 'offline', span);
            setReason('');
            setConfirming(false);
            reload();
        } catch (err) {
            setConfirming(false);
            setFeedback(failureNote('The ban could not be issued', err));
        } finally {
            setSaving(false);
        }
    };

    return (
        <section className="panel" aria-labelledby="ban-panel-title">
            <header className="panel__head">
                <Icon name="ban" size={18} className="panel__icon" />
                <div>
                    <h2 className="panel__title" id="ban-panel-title">Bans</h2>
                    <p className="panel__hint">{headHint(res, bans.length, activeCount)}</p>
                </div>
            </header>

            <div className="panel__body">
                {!canEdit && <PermissionLine what="issue or lift bans" />}

                {res.status === 'unavailable' && (
                    <StatusNote
                        tone="warn"
                        title="Bans are not available in this schema"
                        detail={[res.error, res.hint].filter(Boolean).join(' ')}
                    />
                )}

                {res.status === 'error' && (
                    <StatusNote
                        tone="error"
                        title="The ban record could not be loaded"
                        detail={res.error}
                    />
                )}

                {bans.length > 0 && (
                    <ul className={`lines${bans.length > 3 ? ' lines--scroll' : ''}`}>
                        {bans.map((ban) => (
                            <BanLine
                                key={ban.id}
                                ban={ban}
                                canEdit={canEdit}
                                onFeedback={setFeedback}
                                onChanged={reload}
                                onReport={report}
                            />
                        ))}
                    </ul>
                )}

                {/* This card reads database bans only; the server list adds txAdmin's */}
                {onShowServerBans && citizenid && (
                    <div className="acts">
                        <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            onClick={onShowServerBans}
                        >
                            Server ban list, incl. txAdmin
                        </button>
                    </div>
                )}
            </div>

            <form className="panel__form" onSubmit={handleSubmit}>
                <div className="panel__body">
                    {canEdit && res.status === 'ready' && !identified && (
                        <StatusNote
                            tone="warn"
                            title="This character carries no license and no Discord ID"
                            detail="Bans match on those. Have the citizen connect once."
                        />
                    )}

                    <div className="field">
                        <label className="field__label" htmlFor="ban-reason">Reason</label>
                        <input
                            id="ban-reason"
                            className="input"
                            type="text"
                            autoComplete="off"
                            maxLength={REASON_MAX}
                            placeholder="What happened"
                            value={reason}
                            onChange={(e) => change(setReason)(e.target.value)}
                            disabled={saving || blocked}
                        />
                        <span className="field__hint">
                            {`Shown to the citizen · ${trimmedReason.length}/${REASON_MAX}`}
                        </span>
                    </div>

                    <div className="field">
                        <span className="field__label" id="ban-duration-label">Duration</span>
                        <div className="segment" role="group" aria-labelledby="ban-duration-label">
                            <button
                                type="button"
                                className="segment__btn"
                                aria-pressed={permanent}
                                onClick={() => change(setDuration)('permanent')}
                                disabled={saving || blocked}
                            >
                                Permanent
                            </button>
                            <button
                                type="button"
                                className="segment__btn"
                                aria-pressed={!permanent}
                                onClick={() => change(setDuration)('period')}
                                disabled={saving || blocked}
                            >
                                For a while
                            </button>
                        </div>
                    </div>

                    {!permanent && (
                        <div className="field">
                            <label className="field__label" htmlFor="ban-days">Days</label>
                            <input
                                id="ban-days"
                                className="input u-mono"
                                type="number"
                                inputMode="numeric"
                                min={1}
                                max={MAX_DAYS}
                                step={1}
                                value={days}
                                onChange={(e) => change(setDays)(e.target.value)}
                                disabled={saving || blocked}
                            />
                        </div>
                    )}

                    {confirming && (
                        <p className="field__hint">A connected citizen is kicked at once.</p>
                    )}

                    {feedback && (
                        <StatusNote tone={feedback.tone} title={feedback.title} detail={feedback.detail} />
                    )}
                </div>

                <footer className="panel__foot">
                    <span className="panel__footinfo">
                        {permanent ? 'No end date' : (lifts ? `Until ${lifts}` : `1 to ${MAX_DAYS} days`)}
                    </span>

                    {confirming ? (
                        <>
                            <button type="submit" className="btn btn--danger" disabled={!canSubmit}>
                                {saving ? 'Banning…' : 'Really ban'}
                            </button>
                            <button
                                type="button"
                                className="btn btn--ghost"
                                onClick={() => setConfirming(false)}
                                disabled={saving}
                            >
                                Cancel
                            </button>
                        </>
                    ) : (
                        <button type="submit" className="btn btn--ghost" disabled={!canSubmit}>
                            Ban citizen
                        </button>
                    )}
                </footer>
            </form>
        </section>
    );
}

function headHint(res, count, active) {
    if (res.status === 'loading') return 'Reading the ban record';
    if (res.status === 'unavailable') return 'Module unavailable';
    if (res.status === 'error') return 'Ban record unknown';
    if (count === 0) return 'Clean record';
    return `${active} active of ${count} on record`;
}
