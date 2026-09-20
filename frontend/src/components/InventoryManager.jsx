import { useState } from 'react';
import Icon from './Icon';
import StatusNote from './StatusNote';
import InventorySheet from './InventorySheet';
import { fetchPlayerInventory } from '../api';
import { usePlayerResource } from '../lib/usePlayerResource';

function kg(grams) {
    const n = Number(grams) || 0;
    return `${(n / 1000).toFixed(2)} kg`;
}

/**
 * Inventar in der Modulwand: hier steht nur, was drin ist. Bearbeitet wird
 * es in einer eigenen Flaeche, die der Knopf oeffnet.
 *
 * Grund fuer die Trennung: ein Inventar hat 41 Plaetze und wird geschoben,
 * gestapelt und geteilt. Das braucht Raum und Aufmerksamkeit - eingequetscht
 * zwischen Job und Fahrzeugen waere es weder uebersichtlich noch bedienbar,
 * und man raeumt nicht versehentlich ein Inventar um, waehrend man eigentlich
 * den Rang aendern wollte.
 */
export default function InventoryManager({ selectedPlayer, onApplied }) {
    const citizenid = selectedPlayer?.citizenid;
    const [open, setOpen] = useState(false);
    const [version, setVersion] = useState(0);

    const res = usePlayerResource(fetchPlayerInventory, citizenid, version);
    const data = res.data || {};
    const items = Array.isArray(data.items) ? data.items : [];

    const used = Number(data.totalWeight) || 0;
    const max = Number(data.maxWeight) || 0;
    const pct = max > 0 ? Math.min(100, (used / max) * 100) : 0;

    // Die Flaeche meldet jede Aenderung nach oben; die Karte laedt danach
    // neu, damit Zusammenfassung und Raster nicht auseinanderlaufen.
    const handleApplied = (patch, entry) => {
        setVersion((v) => v + 1);
        onApplied?.(patch, entry);
    };

    // Drei, vier Items als Vorschau reichen, um zu erkennen, worum es geht.
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
                                            style={{ width: `${pct}%` }}
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
                        {data.canReorder === false ? 'Online — slots are locked' : 'Drag, stack and split'}
                    </span>
                    <button
                        type="button"
                        className="btn btn--primary"
                        onClick={() => setOpen(true)}
                        disabled={res.status !== 'ready'}
                    >
                        Open inventory
                    </button>
                </footer>
            </section>

            {open && (
                <InventorySheet
                    citizenid={citizenid}
                    playerName={selectedPlayer?.name || citizenid}
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
