import Amount from './Amount';
import Icon from './Icon';
import PortalNotice from './PortalNotice';
import { usePortalResource } from '../lib/usePortal';
import { fetchMyInventory } from '../api';

/**
 * What a character is carrying.
 *
 * The tiles borrow the panel's grid because an inventory looks like an
 * inventory in both places and two different pictures of the same thing
 * would be worse than one. What they do not borrow is the behaviour: no
 * dragging, no drop targets, no trash. The grab cursor alone would be a
 * promise this surface cannot keep.
 *
 * Only the occupied slots are drawn. The panel pads its grid out to the
 * container's size, which it knows; here the server sends items and a
 * count and says nothing about capacity, so a field of empty squares would
 * be a claim about how much this character can carry that nobody made.
 */
export default function PortalInventory({ citizenid }) {
    const state = usePortalResource(fetchMyInventory, citizenid);

    const items = Array.isArray(state.data?.items) ? state.data.items : [];
    // A copy before sorting: the array belongs to the hook's state, and
    // sorting in place would mutate what React is holding.
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
                                /* The slot number is the natural key, but a
                                   broken row could repeat one; the index
                                   keeps the list stable either way. */
                                key={`${item?.slot ?? 'x'}-${index}`}
                                className="slot slot--static"
                            >
                                <span className="slot__num">{item?.slot ?? '—'}</span>
                                {/* Shortened from ten thousand on, the way the
                                    panel's slots are; the exact count is spoken
                                    and sits in the title. */}
                                <Amount
                                    value={item?.amount ?? '?'}
                                    currency={false}
                                    compactFrom={10000}
                                    className="slot__count u-mono"
                                />
                                <span className="slot__art">
                                    {/* No item images here: the portal's API
                                        sends the plain item name and nothing
                                        to draw, so the first characters of
                                        the name stand in - the same fallback
                                        the panel uses when an icon is
                                        missing. */}
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
