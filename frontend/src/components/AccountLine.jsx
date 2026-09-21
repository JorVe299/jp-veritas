import { useState } from 'react';
import StatusNote from './StatusNote';
import { setAccountFrozen, updateAccount } from '../api';
import { failureNote, modeOf, successNote } from '../lib/writeFeedback';
import { formatDelta, formatMoney, parseAmount } from '../utils/format';

const OPS = [
    { id: 'add', label: 'Add' },
    { id: 'remove', label: 'Remove' },
    { id: 'set', label: 'Set to' },
];

/**
 * A bank account as a row - once in the citizen's card, once in the
 * server-wide overview. The same row in both places, because an account is
 * the same thing in both, and otherwise two ways of operating the same
 * action would creep in.
 *
 * Company accounts (police, mechanic, ...) are expressly marked and require
 * a second press before booking: what hangs off them is not one person's
 * money but that of a whole business.
 *
 * The row changes nothing about its own display. What holds is what the
 * server's answer says - it is handed upwards via onChanged.
 *
 * canEdit comes from outside and is not justified here: the card, or the
 * sheet the row sits in, says it once for all rows. Twenty accounts with
 * twenty identically worded notices would be the same sentence twenty
 * times over.
 */
export default function AccountLine({ account, canEdit = false, onChanged, onReport }) {
    const [editing, setEditing] = useState(false);
    const [op, setOp] = useState('add');
    const [amount, setAmount] = useState('');
    const [confirming, setConfirming] = useState(false);
    const [freezing, setFreezing] = useState(false);
    const [busy, setBusy] = useState(false);
    const [feedback, setFeedback] = useState(null);

    const business = account.kind === 'business';
    const frozen = account.frozen === true;
    const label = account.label || account.id;
    const balance = Number(account.amount) || 0;

    const parsed = parseAmount(amount);
    const valid = Number.isFinite(parsed) && (op === 'set' ? parsed >= 0 : parsed > 0);
    const delta = op === 'set' ? parsed - balance : (op === 'remove' ? -parsed : parsed);
    const next = op === 'set' ? parsed : balance + delta;
    const wouldGoNegative = valid && next < 0;

    const reset = () => {
        setEditing(false);
        setConfirming(false);
        setAmount('');
    };

    const edit = (value) => {
        setAmount(value);
        setConfirming(false);
        setFeedback(null);
    };

    const apply = async () => {
        if (!valid || !canEdit) return;

        // Company account: ask first, then book.
        if (business && !confirming) {
            setConfirming(true);
            setFeedback(null);
            return;
        }

        setBusy(true);
        setFeedback(null);
        try {
            const answer = await updateAccount(
                account.id,
                op === 'remove' ? -parsed : parsed,
                op === 'set' ? 'set' : 'delta',
            );
            const written = answer.data?.account || null;
            const text = op === 'set'
                ? `${label} set to ${formatMoney(parsed)}`
                : `${label} ${formatDelta(delta)}`;

            setFeedback(successNote(answer, text));
            onReport?.(modeOf(answer) ?? 'offline', text);
            reset();
            onChanged?.(written);
        } catch (err) {
            setConfirming(false);
            setFeedback(failureNote('The balance could not be changed', err));
        } finally {
            setBusy(false);
        }
    };

    const toggleFreeze = async () => {
        if (!canEdit) return;

        if (business && !freezing) {
            setFreezing(true);
            setFeedback(null);
            return;
        }

        setBusy(true);
        setFeedback(null);
        try {
            const answer = await setAccountFrozen(account.id, !frozen);
            const text = `${label} ${frozen ? 'unfrozen' : 'frozen'}`;

            setFeedback(successNote(answer, text));
            onReport?.(modeOf(answer) ?? 'offline', text);
            setFreezing(false);
            onChanged?.(answer.data?.account || null);
        } catch (err) {
            setFreezing(false);
            setFeedback(failureNote('The account could not be changed', err));
        } finally {
            setBusy(false);
        }
    };

    return (
        <li className="line">
            <div className="line__top">
                <span className="line__name">{label}</span>
                <span className="pill">{business ? 'Company' : 'Personal'}</span>
                {frozen && <span className="pill pill--debit">Frozen</span>}
                <span className="line__amount u-mono">{formatMoney(balance)}</span>
            </div>

            <div className="line__meta">
                <span className="u-mono">{account.id}</span>
                {account.creator && <span>Opened by {account.creator}</span>}
                <span>
                    {authorizedText(account)}
                </span>
                {business && <span>A whole business draws on this account.</span>}
            </div>

            {editing && (
                <>
                    <div className="line__edit">
                        <div className="field">
                            <span className="field__label" id={`acc-op-${account.id}`}>Change</span>
                            <div className="segment" role="group" aria-labelledby={`acc-op-${account.id}`}>
                                {OPS.map((entry) => (
                                    <button
                                        key={entry.id}
                                        type="button"
                                        className={`segment__btn${entry.id === 'remove' ? ' segment__btn--debit' : ''}`}
                                        aria-pressed={op === entry.id}
                                        onClick={() => { setOp(entry.id); setConfirming(false); setFeedback(null); }}
                                        disabled={busy || !canEdit}
                                    >
                                        {entry.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="field">
                            <label className="field__label" htmlFor={`acc-amount-${account.id}`}>Amount</label>
                            <input
                                id={`acc-amount-${account.id}`}
                                className="input u-mono"
                                type="text"
                                inputMode="numeric"
                                autoComplete="off"
                                placeholder="0"
                                value={amount}
                                onChange={(e) => edit(e.target.value)}
                                disabled={busy || !canEdit}
                            />
                        </div>
                    </div>

                    <div className="preview">
                        <span className="preview__label u-caps">Balance after</span>
                        <span className={previewClass(valid, delta)}>
                            {valid ? formatMoney(next) : 'Enter an amount'}
                        </span>
                    </div>

                    {wouldGoNegative && (
                        <p className="line__meta">
                            The server refuses a negative balance and will answer with an error.
                        </p>
                    )}

                    {confirming && (
                        <p className="line__meta">
                            {`This books ${formatDelta(delta)} on a company account.`}
                        </p>
                    )}
                </>
            )}

            {freezing && (
                <p className="line__meta">
                    {frozen
                        ? 'Unfreezing lets the business move money again.'
                        : 'Freezing stops every transfer on a company account until it is lifted.'}
                </p>
            )}

            <div className="line__actions">
                {editing ? (
                    <>
                        <button
                            type="button"
                            className={`btn btn--sm ${confirming ? 'btn--danger' : 'btn--primary'}`}
                            onClick={apply}
                            disabled={!valid || busy || !canEdit}
                        >
                            {busy ? 'Booking…' : (confirming ? 'Really book' : 'Apply')}
                        </button>
                        <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            onClick={() => { reset(); setFeedback(null); }}
                            disabled={busy}
                        >
                            Cancel
                        </button>
                    </>
                ) : (
                    <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() => { setEditing(true); setFeedback(null); }}
                        disabled={busy || !canEdit}
                    >
                        Adjust balance
                    </button>
                )}

                <button
                    type="button"
                    className={`btn btn--sm ${freezing ? 'btn--danger' : 'btn--ghost'}`}
                    onClick={toggleFreeze}
                    disabled={busy || !canEdit}
                >
                    {freezeLabel(frozen, freezing, busy)}
                </button>

                {freezing && (
                    <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() => setFreezing(false)}
                        disabled={busy}
                    >
                        Cancel
                    </button>
                )}
            </div>

            {feedback && (
                <StatusNote tone={feedback.tone} title={feedback.title} detail={feedback.detail} />
            )}
        </li>
    );
}

function freezeLabel(frozen, freezing, busy) {
    if (busy) return 'Working…';
    if (freezing) return frozen ? 'Really unfreeze' : 'Really freeze';
    return frozen ? 'Unfreeze' : 'Freeze';
}

function authorizedText(account) {
    const count = Number.isFinite(Number(account.authorizedCount))
        ? Number(account.authorizedCount)
        : (Array.isArray(account.authorized) ? account.authorized.length : 0);

    if (count === 0) return 'Nobody else is authorized';
    return count === 1 ? '1 citizen authorized' : `${count} citizens authorized`;
}

function previewClass(valid, delta) {
    if (!valid) return 'preview__value preview__value--empty';
    if (delta === 0) return 'preview__value u-mono';
    return `preview__value u-mono ${delta > 0 ? 'preview__value--up' : 'preview__value--down'}`;
}
