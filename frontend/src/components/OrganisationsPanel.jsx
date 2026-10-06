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
 * Every job and gang as a body of its own, not a field on a character
 * In the server area: on the citizen wall it would read as the selected character's
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
    // Capability flags, not findings: a guessed true would turn "not looked" into "none"
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
                {/* Once per card, not next to every missing figure */}
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

                {/* No account row means missing setup, not an empty balance */}
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

                    </>
                )}

                {!groupsAvailable && res.status === 'ready' && (
                    <p className="field__hint">
                        No player_groups table: only character jobs are counted.
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
