import { useState } from 'react';
import Icon from './Icon';
import PermissionLine from './PermissionLine';
import StatusNote from './StatusNote';
import AccountLine from './AccountLine';
import { fetchPlayerAccounts } from '../api';
import { useCan } from '../lib/useCan';
import { usePlayerResource } from '../lib/usePlayerResource';
import { formatMoney } from '../utils/format';

/**
 * Bank accounts that concern this citizen: their own and every one they
 * have access to.
 *
 * The server-wide list deliberately does not live here. By its position, a
 * card in the citizen grid claims that its content belongs to this citizen -
 * but the police treasury does not. It used to open from here as an overlay
 * anyway, for want of anywhere better; it now sits in the server area with
 * the rest of the things that belong to nobody, and this card only points
 * the way. Two copies of the same list would be one too many.
 *
 * onShowAllAccounts is left out when that area is out of reach, and then so
 * is the button - a door onto nothing explains less than no door.
 */
export default function AccountManager({ selectedPlayer, onApplied, onShowAllAccounts }) {
    const { can } = useCan();
    const canEdit = can('accounts.edit');

    const citizenid = selectedPlayer?.citizenid;
    const [version, setVersion] = useState(0);

    const res = usePlayerResource(fetchPlayerAccounts, citizenid, version);
    const accounts = Array.isArray(res.data?.accounts) ? res.data.accounts : [];

    const reload = () => setVersion((v) => v + 1);
    const report = (mode, text) => onApplied?.({}, { mode, text });

    const held = accounts.reduce((sum, acc) => sum + (Number(acc.amount) || 0), 0);
    const business = accounts.filter((acc) => acc.kind === 'business').length;

    return (
        <section className="panel" aria-labelledby="acc-panel-title">
            <header className="panel__head">
                <Icon name="bank" size={18} className="panel__icon" />
                <div>
                    <h2 className="panel__title" id="acc-panel-title">Bank accounts</h2>
                    <p className="panel__hint">{headHint(res, accounts.length, business)}</p>
                </div>
            </header>

            <div className="panel__body">
                {!canEdit && <PermissionLine what="change balances or freeze accounts" />}

                {res.status === 'unavailable' && (
                    <StatusNote
                        tone="warn"
                        title="Bank accounts are not available in this schema"
                        detail={[res.error, res.hint].filter(Boolean).join(' ')}
                    />
                )}

                {res.status === 'error' && (
                    <StatusNote
                        tone="error"
                        title="The accounts could not be loaded"
                        detail={res.error}
                    />
                )}

                {res.status === 'loading' && <p className="field__hint">Loading accounts…</p>}

                {res.status === 'ready' && accounts.length === 0 && (
                    <p className="field__hint">
                        No account is stored for this citizen, and they are authorized on none.
                    </p>
                )}

                {accounts.length > 0 && (
                    <ul className={`lines${accounts.length > 3 ? ' lines--scroll' : ''}`}>
                        {accounts.map((account) => (
                            <AccountLine
                                key={account.id}
                                account={account}
                                canEdit={canEdit}
                                onChanged={reload}
                                onReport={report}
                            />
                        ))}
                    </ul>
                )}
            </div>

            <footer className="panel__foot">
                <span className="panel__footinfo">
                    {accounts.length > 0
                        ? `${formatMoney(held)} across these accounts`
                        : 'Company accounts live outside any character'}
                </span>
                {onShowAllAccounts && (
                    <button
                        type="button"
                        className="btn btn--ghost"
                        onClick={onShowAllAccounts}
                    >
                        All accounts
                    </button>
                )}
            </footer>
        </section>
    );
}

function headHint(res, count, business) {
    if (res.status === 'loading') return 'Reading the accounts';
    if (res.status === 'unavailable') return 'Module unavailable';
    if (res.status === 'error') return 'Accounts unknown';
    if (count === 0) return 'No account';

    const base = count === 1 ? '1 account' : `${count} accounts`;
    return business > 0 ? `${base}, ${business} of them company` : base;
}
