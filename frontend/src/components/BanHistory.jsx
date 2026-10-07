import { useState } from 'react';
import StatusNote from './StatusNote';
import { deleteBanHistory, fetchBanHistory } from '../api';
import { useCan } from '../lib/useCan';
import { usePlayerResource } from '../lib/usePlayerResource';
import { failureNote } from '../lib/writeFeedback';
import { formatDateTime } from '../utils/format';

// Server's state per entry: 'removed' is a row gone outside the panel, never a guess
const STATES = {
    active: { cls: 'pill--debit', text: 'In force' },
    lifted: { cls: 'pill--off', text: 'Lifted' },
    ended: { cls: 'pill--off', text: 'Ended' },
    removed: { cls: 'pill--off', text: 'Removed elsewhere' },
};

/**
 * Panel bans kept past their `bans` row (lift, expiry); entries go only via banlog.delete
 * Shares the card's reload token: a ban or lift shows up here at once
 */
export default function BanHistory({ citizenid, reloadToken, onChanged }) {
    const { can } = useCan();
    const canDelete = can('banlog.delete');
    const res = usePlayerResource(fetchBanHistory, citizenid, reloadToken);
    const [feedback, setFeedback] = useState(null);

    const entries = Array.isArray(res.data?.entries) ? res.data.entries : [];

    if (res.status === 'loading') return null;

    return (
        <div className="banhist">
            <h3 className="banhist__title u-caps">
                History <span className="banhist__count u-mono">{entries.length}</span>
            </h3>

            {res.status === 'error' && (
                <StatusNote tone="warn" title="The ban history could not be read" detail={res.error} />
            )}

            {res.status === 'ready' && entries.length === 0 && (
                <p className="field__hint">No panel bans on record.</p>
            )}

            {entries.length > 0 && (
                <ul className={`lines${entries.length > 3 ? ' lines--scroll' : ''}`}>
                    {entries.map((entry) => (
                        <HistoryLine
                            key={entry.id}
                            entry={entry}
                            canDelete={canDelete}
                            onFeedback={setFeedback}
                            onChanged={onChanged}
                        />
                    ))}
                </ul>
            )}

            {feedback && <StatusNote tone={feedback.tone} title={feedback.title} detail={feedback.detail} />}
        </div>
    );
}

function HistoryLine({ entry, canDelete, onFeedback, onChanged }) {
    const [confirming, setConfirming] = useState(false);
    const [busy, setBusy] = useState(false);
    const state = STATES[entry.state] ?? STATES.removed;

    const handleDelete = async () => {
        setBusy(true);
        onFeedback(null);
        try {
            await deleteBanHistory(entry.id);
            onFeedback({ tone: 'success', title: 'History entry deleted' });
            onChanged();
        } catch (err) {
            setConfirming(false);
            onFeedback(failureNote('The entry could not be deleted', err));
        } finally {
            setBusy(false);
        }
    };

    return (
        <li className="line">
            <div className="line__top">
                <span className="line__name">{entry.reason || 'No reason recorded'}</span>
                <span className={`pill ${state.cls} line__badge`}>{state.text}</span>
            </div>

            <div className="line__meta">
                <span>
                    {entry.issuedAt ? `Issued ${formatDateTime(entry.issuedAt)}` : 'Issued in game'}
                    {entry.issuedBy ? ` by ${entry.issuedBy}` : ''}
                </span>
                <span>
                    {entry.permanent ? 'Permanent' : `Until ${formatDateTime(entry.expiresAt)}`}
                </span>
                {entry.liftedAt && (
                    <span>
                        {`Lifted ${formatDateTime(entry.liftedAt)}`}
                        {entry.liftedBy ? ` by ${entry.liftedBy}` : ''}
                    </span>
                )}
            </div>

            {canDelete && (
                <div className="line__actions">
                    {confirming ? (
                        <>
                            <button
                                type="button"
                                className="btn btn--danger btn--sm"
                                onClick={handleDelete}
                                disabled={busy}
                            >
                                {busy ? 'Deleting…' : 'Delete entry'}
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
                        >
                            Delete
                        </button>
                    )}
                </div>
            )}
        </li>
    );
}
