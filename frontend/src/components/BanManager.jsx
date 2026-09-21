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
 * A citizen's bans: what is on record, and a new ban.
 *
 * Both in one card, because neither can be judged without the other -
 * whoever issues a ban should see whether one already stands. The record
 * above, the action below, separated by a line.
 *
 * A ban is hard to take back and hits the access, not the character. Hence
 * two steps instead of one click, and no confirm(): the button changes its
 * label and waits there.
 *
 * Workspace gives the module a key={citizenid} - the state restarts by
 * itself when the citizen changes.
 */
export default function BanManager({ selectedPlayer, onApplied }) {
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

    // Without a license and without a Discord ID there is nothing a ban
    // could hang off. The backend answers that with 409 - here it says so
    // up front instead of letting the admin type the text first.
    const identified = Boolean(identity.license || identity.discord);
    const permanent = duration === 'permanent';
    const dayCount = Number.parseInt(days, 10);
    const daysValid = permanent || (Number.isInteger(dayCount) && dayCount >= 1 && dayCount <= MAX_DAYS);
    const trimmedReason = reason.trim();
    const reasonValid = trimmedReason.length >= REASON_MIN && trimmedReason.length <= REASON_MAX;

    // blocked means "not possible right now" and now covers three reasons:
    // the table is missing, it was not readable, the character cannot be
    // identified - or one's own role may not ban. The reason stands above
    // it in each case, so the greyed-out area is not a riddle.
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

        // The first press only asks the question. Only the second submits.
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
                kicked
                    ? 'The citizen was on the server and has been removed from it.'
                    : 'The citizen was not connected, so nothing was interrupted.',
            ));
            // The route the action took: live only when it actually pulled
            // someone off the server as well.
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

                {res.status === 'loading' && <p className="field__hint">Loading the ban record…</p>}

                {res.status === 'ready' && bans.length === 0 && (
                    <p className="field__hint">Nothing on record for this citizen.</p>
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
            </div>

            <form className="panel__form" onSubmit={handleSubmit}>
                <div className="panel__body">
                    {canEdit && res.status === 'ready' && !identified && (
                        <StatusNote
                            tone="warn"
                            title="This character carries no license and no Discord ID"
                            detail="A ban is matched by one of those two, so there is nothing to ban here. Have the citizen connect once, then try again."
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
                            {`Between ${REASON_MIN} and ${REASON_MAX} characters — the citizen is shown this text. ${trimmedReason.length}/${REASON_MAX}`}
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
                            <span className="field__hint">
                                {daysValid && lifts
                                    ? `Lifts on ${lifts}.`
                                    : `1 to ${MAX_DAYS} days.`}
                            </span>
                        </div>
                    )}

                    {confirming && (
                        <p className="field__hint">
                            {permanent
                                ? 'This bans the account for good. If the citizen is on the server they are removed from it right away.'
                                : `This bans the account for ${dayCount} day${dayCount === 1 ? '' : 's'}. If the citizen is on the server they are removed from it right away.`}
                        </p>
                    )}

                    {feedback && (
                        <StatusNote tone={feedback.tone} title={feedback.title} detail={feedback.detail} />
                    )}
                </div>

                <footer className="panel__foot">
                    <span className="panel__footinfo">
                        {permanent ? 'No end date' : (lifts ? `Until ${lifts}` : 'Set a number of days')}
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
