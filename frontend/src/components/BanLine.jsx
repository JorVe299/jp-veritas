import { useState } from 'react';
import StatusNote from './StatusNote';
import { liftBan } from '../api';
import { failureNote, successNote } from '../lib/writeFeedback';
import { formatDateTime } from '../utils/format';

/**
 * Entry of a citizen's ban record (database table)
 * Expired is history, not a block; "never expires" is not a far-off date
 * Lifting deletes the record: two presses, no confirm(); !canEdit is explained by the parent
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
