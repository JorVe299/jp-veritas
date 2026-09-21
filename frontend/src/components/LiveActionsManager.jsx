import { useState } from 'react';
import Icon from './Icon';
import PermissionLine from './PermissionLine';
import StatusNote from './StatusNote';
import {
    fetchPlayerPosition,
    healPlayer,
    kickPlayer,
    notifyPlayer,
    revivePlayer,
    teleportPlayer,
} from '../api';
import { useCan } from '../lib/useCan';
import { usePlayerResource } from '../lib/usePlayerResource';
import { failureNote, successNote } from '../lib/writeFeedback';
import { formatCoord, formatDateTime } from '../utils/format';

const REASON_MIN = 3;
const REASON_MAX = 255;
const MESSAGE_MAX = 255;

const NOTIFY_TYPES = [
    { id: 'inform', label: 'Inform' },
    { id: 'success', label: 'Success' },
    { id: 'error', label: 'Error' },
];

// Raw world coordinates are not operable - nobody knows off the top of
// their head where 441/-982 is. Three places that come up in an admin's
// day are therefore ready as buttons and write the numbers into the fields.
const DESTINATIONS = [
    { id: 'mrpd', name: 'Mission Row PD', x: 441.0, y: -982.0, z: 30.7 },
    { id: 'pillbox', name: 'Pillbox Hospital', x: 298.0, y: -584.0, z: 43.3 },
    { id: 'legion', name: 'Legion Square', x: 215.0, y: -810.0, z: 31.0 },
];

const LIMITS = {
    x: { min: -10000, max: 10000 },
    y: { min: -10000, max: 10000 },
    z: { min: -500, max: 2000 },
};

const OFFLINE_LINE = 'Live actions reach the running game, so they need the citizen to be on '
    + 'the server. The buttons stay disabled until they connect.';

/**
 * Interventions in the running game, and the whereabouts.
 *
 * Two cards, because the two halves carry a different truth value: the
 * actions only exist while someone is connected - offline they are simply
 * not possible. The position, by contrast, is information offline too: it
 * says where the character logged out. Putting both in one card would have
 * devalued the one half along with the other.
 *
 * Not connected therefore means: the buttons stay and are disabled, with a
 * line that names the reason. Cleared away, they would leave open the
 * question of whether the action exists at all.
 */
export default function LiveActionsManager({ selectedPlayer, onApplied }) {
    // The position is information and hangs off players.view, which is what
    // gets this card mounted in the first place. Intervening - kicking,
    // reviving, healing, teleporting, notifying - hangs off actions.live and
    // is independent of that.
    const { can } = useCan();
    const canAct = can('actions.live');

    const citizenid = selectedPlayer?.citizenid;
    const [version, setVersion] = useState(0);
    const [busy, setBusy] = useState(null); // 'revive' | 'heal' | 'notify' | 'kick' | 'teleport'
    const [feedback, setFeedback] = useState(null);

    const [armor, setArmor] = useState(true);
    const [message, setMessage] = useState('');
    const [notifyType, setNotifyType] = useState('inform');
    const [reason, setReason] = useState('');

    const res = usePlayerResource(fetchPlayerPosition, citizenid, version);

    // The position route reports the connection state fresh. As long as it
    // has not answered yet, the state from the wall applies.
    const online = res.status === 'ready'
        ? res.data?.online === true
        : Boolean(selectedPlayer?.isOnline);

    const position = res.data?.position || null;
    const reload = () => setVersion((v) => v + 1);

    /**
     * Every action runs through here. A 409 is not a bug in the program but
     * the information that the citizen has meanwhile left the server - in
     * that case the connection state is pulled along right away, so the card
     * does not keep claiming the opposite.
     */
    const run = async (key, call, logText, failTitle) => {
        setBusy(key);
        setFeedback(null);
        try {
            const answer = await call();
            setFeedback(successNote(answer, logText));
            onApplied?.({}, { mode: 'live', text: logText });
            return answer;
        } catch (err) {
            setFeedback(failureNote(failTitle, err));
            if (err.response?.status === 409) reload();
            return null;
        } finally {
            setBusy(null);
        }
    };

    const trimmedMessage = message.trim();
    const trimmedReason = reason.trim();
    const messageValid = trimmedMessage.length >= 1 && trimmedMessage.length <= MESSAGE_MAX;
    const reasonValid = trimmedReason.length >= REASON_MIN && trimmedReason.length <= REASON_MAX;
    const locked = !online || busy !== null || !canAct;

    const handleNotify = async () => {
        const answer = await run(
            'notify',
            () => notifyPlayer(citizenid, trimmedMessage, notifyType),
            'Message delivered',
            'The message could not be delivered',
        );
        if (answer) setMessage('');
    };

    const handleKick = async () => {
        const answer = await run(
            'kick',
            () => kickPlayer(citizenid, trimmedReason),
            'Citizen kicked from the server',
            'The citizen could not be kicked',
        );
        if (answer) { setReason(''); reload(); }
    };

    const handleTeleport = async (target) => {
        const answer = await run(
            'teleport',
            () => teleportPlayer(citizenid, target),
            `Moved to ${formatCoord(target.x)} / ${formatCoord(target.y)} / ${formatCoord(target.z)}`,
            'The citizen could not be moved',
        );
        if (answer) reload();
        return Boolean(answer);
    };

    return (
        <>
            <section className="panel" aria-labelledby="live-panel-title">
                <header className="panel__head">
                    <Icon name="bolt" size={18} className="panel__icon" />
                    <div>
                        <h2 className="panel__title" id="live-panel-title">Live actions</h2>
                        <p className="panel__hint">
                            {online ? 'The citizen is on the server' : 'The citizen is not on the server'}
                        </p>
                    </div>
                </header>

                <div className="panel__body">
                    {!canAct && <PermissionLine what="act on players in the running game" />}

                    {/* Two different reasons why nothing works, and they
                        may stand side by side: not being allowed is not the
                        same as not being able. */}
                    {!online && <p className="field__hint">{OFFLINE_LINE}</p>}

                    <div className="field">
                        <span className="field__label" id="live-armor-label">Heal restores</span>
                        <div className="segment" role="group" aria-labelledby="live-armor-label">
                            <button
                                type="button"
                                className="segment__btn"
                                aria-pressed={armor}
                                onClick={() => { setArmor(true); setFeedback(null); }}
                                disabled={locked}
                            >
                                Health and armor
                            </button>
                            <button
                                type="button"
                                className="segment__btn"
                                aria-pressed={!armor}
                                onClick={() => { setArmor(false); setFeedback(null); }}
                                disabled={locked}
                            >
                                Health only
                            </button>
                        </div>
                    </div>

                    <div className="acts">
                        <button
                            type="button"
                            className="btn btn--ghost"
                            onClick={() => run('revive', () => revivePlayer(citizenid), 'Citizen revived', 'The citizen could not be revived')}
                            disabled={locked}
                        >
                            {busy === 'revive' ? 'Reviving…' : 'Revive'}
                        </button>
                        <button
                            type="button"
                            className="btn btn--ghost"
                            onClick={() => run('heal', () => healPlayer(citizenid, armor), armor ? 'Citizen healed, armor restored' : 'Citizen healed', 'The citizen could not be healed')}
                            disabled={locked}
                        >
                            {busy === 'heal' ? 'Healing…' : 'Heal'}
                        </button>
                    </div>

                    <div className="field">
                        <label className="field__label" htmlFor="live-message">Message on screen</label>
                        <input
                            id="live-message"
                            className="input"
                            type="text"
                            autoComplete="off"
                            maxLength={MESSAGE_MAX}
                            placeholder="What the citizen should read"
                            value={message}
                            onChange={(e) => { setMessage(e.target.value); setFeedback(null); }}
                            disabled={locked}
                        />
                    </div>

                    <div className="field">
                        <label className="field__label" htmlFor="live-type">Tone</label>
                        <select
                            id="live-type"
                            className="select"
                            value={notifyType}
                            onChange={(e) => { setNotifyType(e.target.value); setFeedback(null); }}
                            disabled={locked}
                        >
                            {NOTIFY_TYPES.map((t) => (
                                <option key={t.id} value={t.id}>{t.label}</option>
                            ))}
                        </select>
                    </div>

                    <div className="acts">
                        <button
                            type="button"
                            className="btn btn--ghost"
                            onClick={handleNotify}
                            disabled={locked || !messageValid}
                        >
                            {busy === 'notify' ? 'Sending…' : 'Send message'}
                        </button>
                    </div>

                    <div className="field">
                        <label className="field__label" htmlFor="live-reason">Kick reason</label>
                        <input
                            id="live-reason"
                            className="input"
                            type="text"
                            autoComplete="off"
                            maxLength={REASON_MAX}
                            placeholder="Why they are being removed"
                            value={reason}
                            onChange={(e) => { setReason(e.target.value); setFeedback(null); }}
                            disabled={locked}
                        />
                        <span className="field__hint">
                            {`${REASON_MIN} to ${REASON_MAX} characters — the citizen is shown this text as they leave.`}
                        </span>
                    </div>

                    {feedback && (
                        <StatusNote tone={feedback.tone} title={feedback.title} detail={feedback.detail} />
                    )}
                </div>

                <footer className="panel__foot">
                    <span className="panel__footinfo">
                        {!canAct
                            ? 'Read-only'
                            : online
                                ? 'Everything here happens at once'
                                : 'Nothing here can run right now'}
                    </span>
                    <button
                        type="button"
                        className="btn btn--ghost"
                        onClick={handleKick}
                        disabled={locked || !reasonValid}
                    >
                        {busy === 'kick' ? 'Kicking…' : 'Kick from server'}
                    </button>
                </footer>
            </section>

            <section className="panel" aria-labelledby="pos-panel-title">
                <header className="panel__head">
                    <Icon name="pin" size={18} className="panel__icon" />
                    <div>
                        <h2 className="panel__title" id="pos-panel-title">Position</h2>
                        <p className="panel__hint">{positionHint(res, online)}</p>
                    </div>
                </header>

                <div className="panel__body">
                    {res.status === 'unavailable' && (
                        <StatusNote
                            tone="warn"
                            title="The position is not available in this schema"
                            detail={[res.error, res.hint].filter(Boolean).join(' ')}
                        />
                    )}

                    {res.status === 'error' && (
                        <StatusNote
                            tone="error"
                            title="The position could not be read"
                            detail={res.error}
                        />
                    )}

                    {res.status === 'loading' && <p className="field__hint">Reading the position…</p>}

                    {res.status === 'ready' && (
                        <>
                            <div className="preview">
                                <span className="preview__label u-caps">
                                    {online ? 'Standing at' : 'Logged out at'}
                                </span>
                                <span className={position ? 'preview__value u-mono' : 'preview__value preview__value--empty'}>
                                    {position
                                        ? `${formatCoord(position.x)} / ${formatCoord(position.y)} / ${formatCoord(position.z)}`
                                        : 'No position on record'}
                                </span>
                            </div>

                            {!online && res.data?.lastLoggedOut && (
                                <p className="field__hint">
                                    Last seen {formatDateTime(res.data.lastLoggedOut)}.
                                </p>
                            )}

                            {!online && <p className="field__hint">{OFFLINE_LINE}</p>}
                        </>
                    )}

                    {/* The teleport is an intervention, not a read - it
                        needs actions.live even though the position above it
                        is freely viewable. Hence the line in this card too:
                        here it applies to the fields below. */}
                    {!canAct && <PermissionLine what="teleport players" />}

                    {/* key remount: as soon as a new position arrives, the
                        fields start with it. No sync effect, no setState in
                        an effect - the key takes care of it. */}
                    <TeleportForm
                        key={`tp-${positionKey(position)}`}
                        start={position}
                        disabled={!online || busy !== null || res.status === 'unavailable' || !canAct}
                        working={busy === 'teleport'}
                        onSubmit={handleTeleport}
                    />
                </div>

                <footer className="panel__foot">
                    <span className="panel__footinfo">
                        {online ? 'Read live from the server' : 'Read from the database'}
                    </span>
                    <button
                        type="button"
                        className="btn btn--ghost"
                        onClick={reload}
                        disabled={res.status === 'loading' || busy !== null}
                    >
                        Refresh
                    </button>
                </footer>
            </section>
        </>
    );
}

const positionKey = (position) => (position
    ? `${position.x}:${position.y}:${position.z}`
    : 'none');

function positionHint(res, online) {
    if (res.status === 'loading') return 'Reading the position';
    if (res.status === 'unavailable') return 'Module unavailable';
    if (res.status === 'error') return 'Position unknown';
    return online ? 'Where they are right now' : 'Where they logged out';
}

/* -------------------------------------------------------------------------
   Teleport. The last known position sits in the fields as the starting
   value - from there one can shift by a few metres without copying
   coordinates from anywhere.
   ------------------------------------------------------------------------- */

function TeleportForm({ start, disabled, working, onSubmit }) {
    const [x, setX] = useState(start ? String(round(start.x)) : '');
    const [y, setY] = useState(start ? String(round(start.y)) : '');
    const [z, setZ] = useState(start ? String(round(start.z)) : '');

    const values = { x: Number(x), y: Number(y), z: Number(z) };
    const filled = x !== '' && y !== '' && z !== '';
    const inRange = (axis) => Number.isFinite(values[axis])
        && values[axis] >= LIMITS[axis].min
        && values[axis] <= LIMITS[axis].max;
    const valid = filled && inRange('x') && inRange('y') && inRange('z');
    const outOfRange = filled && !valid;

    const pick = (dest) => {
        setX(String(dest.x));
        setY(String(dest.y));
        setZ(String(dest.z));
    };

    const matches = (dest) => Number(x) === dest.x && Number(y) === dest.y && Number(z) === dest.z;

    const handle = async () => {
        if (!valid || disabled) return;
        await onSubmit(values);
    };

    return (
        <>
            <div className="field">
                <span className="field__label" id="tp-dest-label">Known places</span>
                <div className="ladder" role="group" aria-labelledby="tp-dest-label">
                    {DESTINATIONS.map((dest) => (
                        <button
                            key={dest.id}
                            type="button"
                            className={`ladder__step${matches(dest) ? ' is-active' : ''}`}
                            onClick={() => pick(dest)}
                            disabled={disabled}
                        >
                            <span className="ladder__name">{dest.name}</span>
                            <span className="ladder__now u-mono">
                                {`${formatCoord(dest.x)} / ${formatCoord(dest.y)}`}
                            </span>
                        </button>
                    ))}
                </div>
                <span className="field__hint">
                    Picking a place fills the coordinates below — nothing is sent yet.
                </span>
            </div>

            <div className="coords">
                <div className="field">
                    <label className="field__label" htmlFor="tp-x">X</label>
                    <input
                        id="tp-x"
                        className="input u-mono"
                        type="number"
                        inputMode="decimal"
                        step="0.1"
                        min={LIMITS.x.min}
                        max={LIMITS.x.max}
                        value={x}
                        onChange={(e) => setX(e.target.value)}
                        disabled={disabled}
                    />
                </div>
                <div className="field">
                    <label className="field__label" htmlFor="tp-y">Y</label>
                    <input
                        id="tp-y"
                        className="input u-mono"
                        type="number"
                        inputMode="decimal"
                        step="0.1"
                        min={LIMITS.y.min}
                        max={LIMITS.y.max}
                        value={y}
                        onChange={(e) => setY(e.target.value)}
                        disabled={disabled}
                    />
                </div>
                <div className="field">
                    <label className="field__label" htmlFor="tp-z">Z</label>
                    <input
                        id="tp-z"
                        className="input u-mono"
                        type="number"
                        inputMode="decimal"
                        step="0.1"
                        min={LIMITS.z.min}
                        max={LIMITS.z.max}
                        value={z}
                        onChange={(e) => setZ(e.target.value)}
                        disabled={disabled}
                    />
                </div>
            </div>

            <span className="field__hint">
                {outOfRange
                    ? 'X and Y run from −10000 to 10000, Z from −500 to 2000.'
                    : 'Ground level in the city sits around Z 30.'}
            </span>

            <div className="acts">
                <button
                    type="button"
                    className="btn btn--primary"
                    onClick={handle}
                    disabled={disabled || !valid}
                >
                    {working ? 'Moving…' : 'Teleport'}
                </button>
            </div>
        </>
    );
}

const round = (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.round(n * 10) / 10 : '';
};
