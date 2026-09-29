import Amount from './Amount';
import Icon from './Icon';
import PortalNotice from './PortalNotice';
import { usePortalResource } from '../lib/usePortal';
import { fetchMyInventory } from '../api';

/**
 * A character's items on the panel's slot grid, static: no drag, drop or trash affordance
 * Occupied slots only: the server sends no capacity, so empty squares would invent one
 */
export default function PortalInventory({ citizenid }) {
    const state = usePortalResource(fetchMyInventory, citizenid);

    const items = Array.isArray(state.data?.items) ? state.data.items : [];
    // Copy first: sorting in place would mutate the hook's state
    const ordered = [...items].sort((a, b) => Number(a?.slot ?? 0) - Number(b?.slot ?? 0));

    return (
        <section className="idpanel">
            <header className="idpanel__head">
                <Icon name="box" size={18} className="idpanel__icon" />
                <h2 className="idpanel__title">Carrying</h2>
                {state.status === 'ready' && (
                    <span className="idpanel__count u-mono">{ordered.length}</span>
                )}
            </header>

            <div className="idpanel__body">
                {state.status === 'loading' && (
                    <div className="grid" role="status" aria-label="Loading the inventory">
                        {[0, 1, 2, 3, 4].map((n) => (
                            <span key={n} className="skeleton idtile" />
                        ))}
                    </div>
                )}

                {state.status === 'failed' && (
                    <PortalNotice
                        code={state.code}
                        error={state.error}
                        hint={state.hint}
                        onRetry={state.reload}
                    />
                )}

                {state.status === 'ready' && ordered.length === 0 && (
                    <p className="idnone">This character is carrying nothing.</p>
                )}

                {state.status === 'ready' && ordered.length > 0 && (
                    <ul className="grid idgrid">
                        {ordered.map((item, index) => (
                            <li
                                /* A broken row could repeat a slot number */
                                key={`${item?.slot ?? 'x'}-${index}`}
                                className="slot slot--static"
                            >
                                <span className="slot__num">{item?.slot ?? '—'}</span>
                                {/* Same threshold as the panel's slots */}
                                <Amount
                                    value={item?.amount ?? '?'}
                                    currency={false}
                                    compactFrom={10000}
                                    className="slot__count u-mono"
                                />
                                <span className="slot__art">
                                    {/* No item image from the API: the panel's fallback */}
                                    <span className="slot__fallback">
                                        {String(item?.name ?? '?').slice(0, 3)}
                                    </span>
                                </span>
                                <span
                                    className="slot__label"
                                    title={item?.name ? `${item?.amount ?? '?'}× ${item.name}` : undefined}
                                >
                                    {item?.name ?? 'Unnamed item'}
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </section>
    );
}
