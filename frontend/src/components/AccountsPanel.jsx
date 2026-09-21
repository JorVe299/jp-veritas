import { useState } from 'react';
import AccountLine from './AccountLine';
import Icon from './Icon';
import PermissionLine from './PermissionLine';
import StatusNote from './StatusNote';
import { fetchAccounts } from '../api';
import { useCan } from '../lib/useCan';
import { useServerList } from '../lib/useServerData';
import { formatMoney } from '../utils/format';

const LIMIT = 40;

/**
 * Every account on the server, personal and company.
 *
 * This used to be an overlay opened out of the citizen's account card, which
 * was the wrong shape twice over: it sat inside a view built around one
 * character while holding the company accounts that belong to no character,
 * and it could only be reached by first picking somebody at random. It now
 * lives in the server area, where the rest of the ownerless things are, and
 * the card in the citizen view points here instead of carrying a second copy.
 *
 * The search runs on the server and debounced, as in the large catalogs.
 */
export default function AccountsPanel() {
    const { can } = useCan();
    const canEdit = can('accounts.edit');

    const [search, setSearch] = useState('');
    const [token, setToken] = useState(0);

    const res = useServerList(fetchAccounts, { search, limit: LIMIT, token });

    const data = res.data || {};
    const accounts = Array.isArray(data.accounts) ? data.accounts : [];
    const count = Number(data.count ?? accounts.length);
    const totalHeld = Number.isFinite(Number(data.totalHeld)) ? Number(data.totalHeld) : null;
    const more = count > accounts.length;

    return (
        <section className="panel" aria-labelledby="accs-panel-title">
            <header className="panel__head">
                <Icon name="bank" size={18} className="panel__icon" />
                <div>
                    <h2 className="panel__title" id="accs-panel-title">Accounts</h2>
                    <p className="panel__hint">{headHint(res, count, totalHeld)}</p>
                </div>
            </header>

            <div className="panel__body">
                {!canEdit && <PermissionLine what="change balances or freeze accounts" />}

                <p className="field__hint">
                    Every account on this server. The company accounts hang off no
                    character at all — without this list there is nowhere in the panel
                    they could be reached.
                </p>

                <div className="field">
                    <label className="field__label" htmlFor="accs-search">Search</label>
                    <input
                        id="accs-search"
                        className="input"
                        type="search"
                        autoComplete="off"
                        placeholder="Account name, id or owner"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                </div>

                {res.status === 'unavailable' && (
                    <StatusNote
                        tone="warn"
                        title="The account list is not available in this schema"
                        detail={[res.error, res.hint].filter(Boolean).join(' ')}
                    />
                )}

                {res.status === 'unreachable' && (
                    <StatusNote
                        tone="warn"
                        title="The game server did not answer"
                        detail={[res.error, res.hint].filter(Boolean).join(' ')}
                    />
                )}

                {res.status === 'error' && (
                    <StatusNote
                        tone="error"
                        title="The accounts could not be loaded"
                        detail={[res.error, res.hint].filter(Boolean).join(' ')}
                    />
                )}

                {res.waiting && res.status === 'loading' && (
                    <p className="field__hint">Loading accounts…</p>
                )}

                {res.status === 'ready' && accounts.length === 0 && (
                    <p className="field__hint">
                        {search ? `No account matches “${search}”.` : 'This server holds no accounts.'}
                    </p>
                )}

                {accounts.length > 0 && (
                    <ul className={`lines${res.isStale ? ' is-stale' : ''}`} aria-busy={res.isStale}>
                        {accounts.map((account) => (
                            <AccountLine
                                key={account.id}
                                account={account}
                                canEdit={canEdit}
                                onChanged={() => setToken((v) => v + 1)}
                            />
                        ))}
                    </ul>
                )}

                {res.status === 'ready' && more && (
                    <p className="field__hint">
                        {`Showing the first ${accounts.length} of ${count} — narrow the search.`}
                    </p>
                )}
            </div>
        </section>
    );
}

function headHint(res, count, totalHeld) {
    if (res.waiting && res.status === 'loading') return 'Reading the accounts';
    if (res.status === 'unavailable') return 'Module unavailable';
    if (res.status === 'unreachable') return 'Game server unreachable';
    if (res.status === 'error') return 'Accounts unknown';
    if (count === 0) return 'No account';

    const base = count === 1 ? '1 account' : `${count} accounts`;
    return totalHeld !== null ? `${base} · ${formatMoney(totalHeld)} held in total` : base;
}
