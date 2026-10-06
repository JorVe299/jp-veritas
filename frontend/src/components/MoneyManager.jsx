import { useState } from 'react';
import Icon from './Icon';
import PermissionLine from './PermissionLine';
import StatusNote from './StatusNote';
import { updatePlayerMoney } from '../api';
import { useCan } from '../lib/useCan';
import { formatCurrency, formatDelta, parseAmount } from '../utils/format';

const ACCOUNTS = [
    { id: 'cash', label: 'Cash', icon: 'cash' },
    { id: 'bank', label: 'Bank', icon: 'bank' },
];

// Workspace keys this by citizenid: amount and selection reset with the citizen
export default function MoneyManager({ selectedPlayer, onApplied }) {
    const { can } = useCan();
    const canEdit = can('money.edit');

    const [account, setAccount] = useState('cash');
    const [direction, setDirection] = useState('add'); // 'add' | 'remove'
    const [amount, setAmount] = useState('');
    const [saving, setSaving] = useState(false);
    const [feedback, setFeedback] = useState(null);

    const balance = Number(selectedPlayer?.money?.[account] ?? 0);
    const parsed = parseAmount(amount);
    const isValid = Number.isFinite(parsed) && parsed > 0;
    const delta = isValid ? (direction === 'add' ? parsed : -parsed) : 0;
    const nextBalance = balance + delta;
    const canSubmit = isValid && !saving && canEdit;

    const accountLabel = ACCOUNTS.find((a) => a.id === account)?.label ?? account;

    // Feedback answered the previous form state: clear it on any edit
    const clearFeedback = () => setFeedback(null);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!canSubmit) return;

        setSaving(true);
        setFeedback(null);
        try {
            const res = await updatePlayerMoney(selectedPlayer.citizenid, delta, account);

            // Offline answers carry the new balance; for live ones it is computed here
            const money = res.data.money
                ? { ...selectedPlayer.money, ...res.data.money }
                : { ...selectedPlayer.money, [account]: nextBalance };

            const mode = res.data.mode === 'live' ? 'live' : 'offline';

            setFeedback({
                tone: 'success',
                title: `${formatDelta(delta)} posted to ${accountLabel.toLowerCase()}`,
                detail: `${mode === 'live'
                    ? 'Applied live.'
                    : 'Saved to the database.'
                    } New balance: ${formatCurrency(money[account])}.`,
            });

            setAmount('');
            onApplied?.(
                { money },
                { mode, text: `${accountLabel} ${formatDelta(delta)}, now ${formatCurrency(money[account])}` },
            );
        } catch (err) {
            setFeedback({
                tone: 'error',
                title: 'The transaction failed',
                detail: err.response?.data?.error || err.message,
            });
        } finally {
            setSaving(false);
        }
    };

    return (
        <section className="panel" aria-labelledby="money-panel-title">
            <header className="panel__head">
                <Icon name="cash" size={18} className="panel__icon" />
                <div>
                    <h2 className="panel__title" id="money-panel-title">Balances</h2>
                    <p className="panel__hint">Credit or debit cash and bank</p>
                </div>
            </header>

            <form className="panel__form" onSubmit={handleSubmit}>
                <div className="panel__body">
                    {!canEdit && <PermissionLine what="change balances" />}

                    <div className="panel__row">
                        <div className="field">
                            <span className="field__label" id="account-label">Account</span>
                            <div className="segment" role="group" aria-labelledby="account-label">
                                {ACCOUNTS.map((a) => (
                                    <button
                                        key={a.id}
                                        type="button"
                                        className="segment__btn"
                                        aria-pressed={account === a.id}
                                        onClick={() => { setAccount(a.id); clearFeedback(); }}
                                        disabled={saving || !canEdit}
                                    >
                                        <Icon name={a.icon} size={15} />
                                        {a.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="field">
                            <span className="field__label" id="direction-label">Direction</span>
                            <div className="segment" role="group" aria-labelledby="direction-label">
                                <button
                                    type="button"
                                    className="segment__btn"
                                    aria-pressed={direction === 'add'}
                                    onClick={() => { setDirection('add'); clearFeedback(); }}
                                    disabled={saving || !canEdit}
                                >
                                    <Icon name="plus" size={15} />
                                    Credit
                                </button>
                                <button
                                    type="button"
                                    className="segment__btn segment__btn--debit"
                                    aria-pressed={direction === 'remove'}
                                    onClick={() => { setDirection('remove'); clearFeedback(); }}
                                    disabled={saving || !canEdit}
                                >
                                    <Icon name="minus" size={15} />
                                    Debit
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="field">
                        <label className="field__label" htmlFor="money-amount">Amount</label>
                        <input
                            id="money-amount"
                            className="input u-mono"
                            type="text"
                            inputMode="numeric"
                            autoComplete="off"
                            placeholder="2500"
                            value={amount}
                            onChange={(e) => { setAmount(e.target.value); clearFeedback(); }}
                            disabled={saving || !canEdit}
                            aria-describedby="money-preview"
                        />
                        <span className="field__hint">
                            {accountLabel} currently holds {formatCurrency(balance)}
                        </span>
                    </div>

                    <div className="preview" id="money-preview">
                        <span className="preview__label u-caps">Balance after</span>
                        <span className={previewClass(isValid, delta)}>
                            {isValid
                                ? `${formatCurrency(nextBalance)} (${formatDelta(delta)})`
                                : 'Enter an amount'}
                        </span>
                    </div>

                    {isValid && nextBalance < 0 && (
                        <StatusNote
                            tone="warn"
                            title="This will overdraw the account"
                        />
                    )}

                    {feedback && (
                        <StatusNote tone={feedback.tone} title={feedback.title} detail={feedback.detail} />
                    )}
                </div>

                <footer className="panel__foot">
                    <span className="panel__footinfo">
                        {isValid ? accountLabel : 'No amount'}
                    </span>
                    <button type="submit" className="btn btn--primary" disabled={!canSubmit}>
                        {saving ? 'Posting…' : 'Post transaction'}
                    </button>
                </footer>
            </form>
        </section>
    );
}

// Mono only for measured values; the empty-state hint uses the normal face
function previewClass(isValid, delta) {
    if (!isValid) return 'preview__value preview__value--empty';
    return `preview__value u-mono ${delta > 0 ? 'preview__value--up' : 'preview__value--down'}`;
}
