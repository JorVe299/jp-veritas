import { useState } from 'react';
import StatusNote from './StatusNote';
import { liftBan } from '../api';
import { failureNote, successNote } from '../lib/writeFeedback';
import { formatDateTime } from '../utils/format';

/**
 * One entry of the ban record - once inside a citizen's card, once in the
 * server-wide list. The same row in both places, the same way it is lifted,
 * because a ban is the same thing in both.
 *
 * Two distinctions the row has to carry:
 *   active vs. expired - an expired ban is history, not a block,
 *   permanent vs. until a date - "never expires" is not a date far away.
 *
 * Lifting deletes the record, so it takes two presses and no confirm()
 * dialog: the button changes its label and waits there.
 *
 * `canEdit` comes from outside and is not justified here. The card or panel
 * the row sits in says it once for all rows - twenty identically worded
 * notices would be the same sentence twenty times over.
 *
 * `onFeedback` is where the result goes; the caller decides whether that is
 * its own state or a shared line. `onReport` is optional: the citizen view
 * writes into the session log, the server-wide list has no such log.
 */
export default function BanLine({ ban, canEdit, onFeedback, onChanged, onReport }) {
    const [confirming, setConfirming] = useState(false);
    const [busy, setBusy] = useState(false);

    const active = ban.active !== false;
    const permanent = Boolean(ban.permanent);
    const badge = active
        ? { cls: 'pill--debit', text: permanent ? 'Permanent' : 'Active' }
        : { cls: 'pill--off', text: 'Expired' };

    const handleLift = async () => {
        setBusy(true);
        onFeedback(null);
        try {
            const answer = await liftBan(ban.id);
            onFeedback(successNote(answer, 'Ban lifted', 'The account can connect again.'));
            onReport?.('offline', `Ban #${ban.id} lifted`);
            onChanged();
        } catch (err) {
            setConfirming(false);
            onFeedback(failureNote('The ban could not be lifted', err));
        } finally {
            setBusy(false);
        }
    };

    return (
        <li className="line">
            <div className="line__top">
                <span className="line__name">{ban.reason || 'No reason recorded'}</span>
                <span className={`pill ${badge.cls} line__badge`}>{badge.text}</span>
            </div>

            <div className="line__meta">
                <span>By {ban.bannedBy || 'unknown'}</span>
                <span>
                    {permanent ? 'Never expires' : `Until ${formatDateTime(ban.expiresAt ?? ban.expire)}`}
                </span>
                {ban.name && <span>As {ban.name}</span>}
                {ban.discord && <span className="u-mono">Discord {ban.discord}</span>}
                {!ban.discord && ban.license && <span className="u-mono">{ban.license}</span>}
                {ban.ip && <span className="u-mono">{ban.ip}</span>}
            </div>

            {confirming && (
                <p className="line__meta">
                    Lifting deletes this record. The account can connect again right away.
                </p>
            )}

            <div className="line__actions">
                {confirming ? (
                    <>
                        <button
                            type="button"
                            className="btn btn--danger btn--sm"
                            onClick={handleLift}
                            disabled={busy || !canEdit}
                        >
                            {busy ? 'Lifting…' : 'Really lift'}
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
                        Lift ban
                    </button>
                )}
            </div>
        </li>
    );
}
