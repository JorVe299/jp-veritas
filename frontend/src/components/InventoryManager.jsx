import { useState } from 'react';
import Icon from './Icon';
import PermissionLine from './PermissionLine';
import StatusNote from './StatusNote';
import InventorySheet from './InventorySheet';
import { fetchPlayerInventory } from '../api';
import { useCan } from '../lib/useCan';
import { usePlayerResource } from '../lib/usePlayerResource';

function kg(grams) {
    const n = Number(grams) || 0;
    return `${(n / 1000).toFixed(2)} kg`;
}

/**
 * Inventory in the module wall: this only states what is in it. Editing
 * happens in a sheet of its own that the button opens.
 *
 * Reason for the split: an inventory has 41 slots and gets dragged, stacked
 * and split. That needs room and attention - squeezed in between job and
 * vehicles it would be neither legible nor usable, and this way nobody
 * rearranges an inventory by accident while what they really wanted was to
 * change the rank.
 */
export default function InventoryManager({ selectedPlayer, onApplied }) {
    // inventory.view carries the card, inventory.edit the grid in the sheet.
    // Without the second the sheet stays reachable all the same: looking at
    // all 41 slots is something other than rearranging them.
    const { can } = useCan();
    const canEdit = can('inventory.edit');

    const citizenid = selectedPlayer?.citizenid;
    const [open, setOpen] = useState(false);
    const [version, setVersion] = useState(0);

    const res = usePlayerResource(fetchPlayerInventory, citizenid, version);
    const data = res.data || {};
    const items = Array.isArray(data.items) ? data.items : [];

    const used = Number(data.totalWeight) || 0;
    const max = Number(data.maxWeight) || 0;
    const pct = max > 0 ? Math.min(100, (used / max) * 100) : 0;

    // The sheet reports every change upwards; the card then reloads so that
    // summary and grid do not drift apart.
    const handleApplied = (patch, entry) => {
        setVersion((v) => v + 1);
        onApplied?.(patch, entry);
    };

    // Three or four items as a preview are enough to tell what this is about.
    const peek = items.slice(0, 4);
    const rest = items.length - peek.length;

    return (
        <>
            <section className="panel" aria-labelledby="inv-panel-title">
                <header className="panel__head">
                    <Icon name="box" size={18} className="panel__icon" />
                    <div>
                        <h2 className="panel__title" id="inv-panel-title">Inventory</h2>
                        <p className="panel__hint">{summaryHint(res, data, items.length)}</p>
                    </div>
                </header>

                <div className="panel__body">
                    {!canEdit && <PermissionLine what="add, remove or move items" />}

                    {res.status === 'unavailable' && (
                        <StatusNote
                            tone="warn"
                            title="The inventory is not available in this schema"
                            detail={[res.error, res.hint].filter(Boolean).join(' ')}
                        />
                    )}

                    {res.status === 'error' && (
                        <StatusNote
                            tone="error"
                            title="The inventory could not be loaded"
                            detail={res.error}
                        />
                    )}

                    {res.status === 'loading' && <p className="field__hint">Loading inventory…</p>}

                    {res.status === 'ready' && (
                        <div className="invsum">
                            {data.hint && <p className="field__hint">{data.hint}</p>}

                            {max > 0 && (
                                <div className="weigh">
                                    <div className="weigh__head">
                                        <span>Weight</span>
                                        <span className="weigh__value u-mono">{kg(used)} / {kg(max)}</span>
                                    </div>
                                    <div
                                        className="weigh__bar"
                                        role="progressbar"
                                        aria-valuenow={Math.round(pct)}
                                        aria-valuemin={0}
                                        aria-valuemax={100}
                                        aria-label="Inventory weight"
                                    >
                                        <div
                                            className={`weigh__fill${used > max ? ' weigh__fill--over' : ''}`}
                                            style={{ transform: `scaleX(${pct / 100})` }}
                                        />
                                    </div>
                                </div>
                            )}

                            {items.length === 0 ? (
                                <p className="field__hint">
                                    {data.format === 'empty'
                                        ? 'No inventory is stored for this citizen.'
                                        : 'The inventory is empty.'}
                                </p>
                            ) : (
                                <div className="invsum__peek">
                                    {peek.map((it) => (
                                        <span className="invsum__chip" key={`${it.slot}-${it.name}`}>
                                            <span className="invsum__chipcount u-mono">{it.amount}×</span>
                                            {it.label}
                                        </span>
                                    ))}
                                    {rest > 0 && <span className="invsum__chip">+{rest} more</span>}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                <footer className="panel__foot">
                    <span className="panel__footinfo">
                        {!canEdit
                            ? 'Read-only'
                            : data.canReorder === false
                                ? 'Online — slots are locked'
                                : 'Drag, stack and split'}
                    </span>
                    <button
                        type="button"
                        className="btn btn--primary"
                        onClick={() => setOpen(true)}
                        disabled={res.status !== 'ready'}
                    >
                        {canEdit ? 'Open inventory' : 'View inventory'}
                    </button>
                </footer>
            </section>

            {open && (
                <InventorySheet
                    citizenid={citizenid}
                    playerName={selectedPlayer?.name || citizenid}
                    canEdit={canEdit}
                    onClose={() => setOpen(false)}
                    onApplied={handleApplied}
                />
            )}
        </>
    );
}

function summaryHint(res, data, count) {
    if (res.status === 'loading') return 'Reading the contents';
    if (res.status === 'unavailable') return 'Module unavailable';
    if (res.status === 'error') return 'Contents unknown';

    const slots = Number(data.maxSlots);
    return Number.isFinite(slots) && slots > 0
        ? `${count} of ${slots} slots used`
        : `${count} entries`;
}
