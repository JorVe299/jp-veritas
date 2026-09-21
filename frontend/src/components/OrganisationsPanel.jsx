import { useState } from 'react';
import Icon from './Icon';
import OrganisationLine from './OrganisationLine';
import PermissionLine from './PermissionLine';
import StatusNote from './StatusNote';
import { fetchOrganisations } from '../api';
import { useCan } from '../lib/useCan';
import { useServerList } from '../lib/useServerData';
import { formatMoney } from '../utils/format';

const TYPES = [
    { id: 'all', label: 'All' },
    { id: 'job', label: 'Jobs' },
    { id: 'gang', label: 'Gangs' },
];

/**
 * Every job and gang on the server, seen as a body rather than as a field on
 * a character.
 *
 * This is why the server area exists at all. A police force has a balance, a
 * headcount and a rank structure whether or not anybody is looking at a
 * single officer - and a card in the citizen wall would claim, by its
 * position alone, that its contents belong to the selected character.
 *
 * The search runs on the server and debounced, as in the large catalogs.
 */
export default function OrganisationsPanel() {
    const { can } = useCan();
    const canEditAccounts = can('accounts.edit');

    const [search, setSearch] = useState('');
    const [type, setType] = useState('all');
    const [token, setToken] = useState(0);

    const res = useServerList(fetchOrganisations, { search, type, token });

    const data = res.data || {};
    const organisations = Array.isArray(data.organisations) ? data.organisations : [];
    // Both flags describe what the server was able to answer, not what it
    // found. Guessed defaults would turn "we did not look" into "there is
    // none", so the falsy reading is the careful one in both cases.
    const moneyVisible = data.moneyVisible === true;
    const groupsAvailable = data.groupsAvailable === true;
    const totals = data.totals || null;
    const count = Number(data.count ?? organisations.length);

    return (
        <section className="panel" aria-labelledby="orgs-panel-title">
            <header className="panel__head">
                <Icon name="briefcase" size={18} className="panel__icon" />
                <div>
                    <h2 className="panel__title" id="orgs-panel-title">Organisations</h2>
                    <p className="panel__hint">{headHint(res, count)}</p>
                </div>
            </header>

            <div className="panel__body">
                {/* Once per card. Without accounts.view the server strips the
                    money out of every row, so the reason belongs here rather
                    than next to thirty missing figures. */}
                {!moneyVisible && res.status === 'ready' && (
                    <PermissionLine what="see what these organisations hold" />
                )}
                {moneyVisible && !canEditAccounts && (
                    <PermissionLine what="change organisation balances" />
                )}

                <div className="panel__row">
                    <div className="field">
                        <label className="field__label" htmlFor="orgs-search">Search</label>
                        <input
                            id="orgs-search"
                            className="input"
                            type="search"
                            autoComplete="off"
                            placeholder="Name or label"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                        />
                    </div>

                    <div className="field">
                        <span className="field__label" id="orgs-type-label">Kind</span>
                        <div className="segment" role="group" aria-labelledby="orgs-type-label">
                            {TYPES.map((entry) => (
                                <button
                                    key={entry.id}
                                    type="button"
                                    className="segment__btn"
                                    aria-pressed={type === entry.id}
                                    onClick={() => setType(entry.id)}
                                >
                                    {entry.label}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {/* The whole point of the totals: an organisation with no
                    account row is missing setup, and that is a different
                    thing from one holding nothing. */}
                {moneyVisible && totals && (
                    <>
                        <div className="tally tally--wide">
                            <div className="tally__item">
                                <span className="tally__value u-mono">{formatMoney(totals.held)}</span>
                                <span className="tally__key">held across these accounts</span>
                            </div>
                            <div className="tally__item">
                                <span className="tally__value u-mono">{Number(totals.withoutAccount) || 0}</span>
                                <span className="tally__key">with no account at all</span>
                            </div>
                        </div>

                        {Number(totals.withoutAccount) > 0 && (
                            <p className="field__hint">
                                “No account” means no account row exists for that organisation.
                                That is not a balance of zero — those are the ones whose banking
                                has never been set up.
                            </p>
                        )}
                    </>
                )}

                {!groupsAvailable && res.status === 'ready' && (
                    <p className="field__hint">
                        This schema has no player_groups table, so no membership numbers exist.
                        Only the job written on each character is counted here.
                    </p>
                )}

                {res.status === 'unavailable' && (
                    <StatusNote
                        tone="warn"
                        title="Organisations are not available in this schema"
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
                        title="The organisations could not be loaded"
                        detail={[res.error, res.hint].filter(Boolean).join(' ')}
                    />
                )}

                {res.waiting && res.status === 'loading' && (
                    <p className="field__hint">Loading jobs and gangs…</p>
                )}

                {res.status === 'ready' && organisations.length === 0 && (
                    <p className="field__hint">
                        {search
                            ? `No ${type === 'all' ? 'organisation' : type} matches “${search}”.`
                            : type === 'gang'
                                ? 'This server has no gangs configured.'
                                : type === 'job'
                                    ? 'This server has no jobs configured.'
                                    : 'This server has no jobs and no gangs configured.'}
                    </p>
                )}

                {organisations.length > 0 && (
                    <ul className={`lines${res.isStale ? ' is-stale' : ''}`} aria-busy={res.isStale}>
                        {organisations.map((organisation) => (
                            <OrganisationLine
                                key={`${organisation.type}:${organisation.name}`}
                                organisation={organisation}
                                moneyVisible={moneyVisible}
                                groupsAvailable={groupsAvailable}
                                canEditAccounts={canEditAccounts}
                                onAccountChanged={() => setToken((v) => v + 1)}
                            />
                        ))}
                    </ul>
                )}
            </div>
        </section>
    );
}

function headHint(res, count) {
    if (res.waiting && res.status === 'loading') return 'Reading jobs and gangs';
    if (res.status === 'unavailable') return 'Module unavailable';
    if (res.status === 'unreachable') return 'Game server unreachable';
    if (res.status === 'error') return 'Organisations unknown';
    if (count === 0) return 'Nothing configured';
    return count === 1 ? '1 organisation' : `${count} organisations`;
}
