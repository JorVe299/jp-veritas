import { useCallback, useEffect, useRef, useState } from 'react';
import Icon from './Icon';
import StatusNote from './StatusNote';
import CatalogPicker from './CatalogPicker';
import { fetchPlayerInventory, updatePlayerInventory } from '../api';
import { parseAmount } from '../utils/format';

const errorText = (err) => err.response?.data?.error || err.message;

const modeDetail = (mode) => (mode === 'live'
    ? 'Applied live on the server.'
    : 'The citizen is not connected, so the change went to the database.');

// Gramm sind im Rohwert unlesbar; ox_inventory zeigt selbst Kilogramm.
function kg(grams) {
    const n = Number(grams) || 0;
    return `${(n / 1000).toFixed(2)} kg`;
}

/**
 * Das Inventar als Raster, dem im Spiel nachempfunden.
 *
 * Die Kacheln sind echte Bedienelemente: ziehen verschiebt, tauscht oder
 * legt zusammen, ablegen auf dem Papierkorb bucht aus, der Katalog rechts
 * legt neue Items ein. Was am Ende zaehlt, entscheidet aber immer das
 * Backend - die Antwort jeder Mutation traegt die neue Belegung, und genau
 * die wird angezeigt. Nichts wird optimistisch vorweggenommen, sonst zeigte
 * das Raster nach einem abgelehnten Zug einen Zustand, den es nicht gibt.
 */
export default function InventorySheet({ citizenid, playerName, onClose, onApplied }) {
    const [state, setState] = useState({ status: 'loading', data: null, error: null });
    const [feedback, setFeedback] = useState(null);
    const [busy, setBusy] = useState(false);
    const [dragging, setDragging] = useState(null); // { kind: 'slot'|'catalog', ... }
    const [dropTarget, setDropTarget] = useState(null); // Slotnummer oder 'trash'
    const [selected, setSelected] = useState(null); // Slotnummer
    const closeRef = useRef(null);

    // Erstes Laden. Das cancelled-Flag verhindert, dass eine spaete Antwort
    // eine bereits geschlossene Flaeche noch beschreibt.
    useEffect(() => {
        let cancelled = false;
        fetchPlayerInventory(citizenid)
            .then((res) => {
                if (!cancelled) setState({ status: 'ready', data: res.data || {}, error: null });
            })
            .catch((err) => {
                if (!cancelled) setState({ status: 'error', data: null, error: errorText(err) });
            });
        return () => { cancelled = true; };
    }, [citizenid]);

    // Escape schliesst. Der Fokus landet beim Oeffnen auf dem Schliessen-Knopf,
    // damit Tastaturbedienung nicht hinter der Flaeche weiterlaeuft.
    useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        closeRef.current?.focus();
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    const data = state.data || {};
    const items = Array.isArray(data.items) ? data.items : [];
    const maxSlots = Number(data.maxSlots) || 41;
    const canReorder = data.canReorder !== false;

    const bySlot = new Map(items.map((it) => [it.slot, it]));
    const used = Number(data.totalWeight) || 0;
    const max = Number(data.maxWeight) || 0;
    const pct = max > 0 ? Math.min(100, (used / max) * 100) : 0;

    // Jede Mutation laeuft hier durch: entweder liefert die Antwort die neue
    // Belegung mit (Offline-Weg), oder wir holen sie nach (Live-Weg, dort
    // kennt nur der Server das Ergebnis).
    const mutate = useCallback(async (change, logText) => {
        setBusy(true);
        setFeedback(null);
        try {
            const answer = await updatePlayerInventory(citizenid, change);
            const mode = answer.data?.mode === 'live' ? 'live' : 'offline';

            if (Array.isArray(answer.data?.items)) {
                setState((prev) => ({
                    ...prev,
                    data: {
                        ...prev.data,
                        items: answer.data.items,
                        totalWeight: answer.data.totalWeight ?? prev.data.totalWeight,
                    },
                }));
            } else {
                const fresh = await fetchPlayerInventory(citizenid);
                setState({ status: 'ready', data: fresh.data || {}, error: null });
            }

            setFeedback({ tone: 'success', title: answer.data?.message || logText, detail: modeDetail(mode) });
            onApplied?.({}, { mode, text: logText });
            return true;
        } catch (err) {
            const body = err.response?.data;
            setFeedback({
                tone: 'error',
                title: body?.error || 'The inventory could not be changed',
                detail: body?.hint || (body?.error ? undefined : err.message),
            });
            return false;
        } finally {
            setBusy(false);
        }
    }, [citizenid, onApplied]);

    // --- Ziehen und Ablegen ------------------------------------------------

    const startSlotDrag = (e, item) => {
        if (!canReorder || busy) { e.preventDefault(); return; }
        setDragging({ kind: 'slot', slot: item.slot, name: item.name, label: item.label, amount: item.amount });
        e.dataTransfer.effectAllowed = 'move';
        // Firefox startet ohne gesetzte Daten gar keinen Zug.
        e.dataTransfer.setData('text/plain', String(item.slot));
    };

    const endDrag = () => { setDragging(null); setDropTarget(null); };

    const allowDrop = (e, target) => {
        if (!dragging) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = target === 'trash' ? 'move' : 'move';
        setDropTarget(target);
    };

    const dropOnSlot = async (e, slotNumber) => {
        e.preventDefault();
        const drag = dragging;
        endDrag();
        if (!drag || busy) return;

        if (drag.kind === 'catalog') {
            const target = bySlot.get(slotNumber);
            if (target && target.name !== drag.name) {
                setFeedback({ tone: 'error', title: `Slot ${slotNumber} already holds ${target.label}` });
                return;
            }
            await mutate(
                { action: 'add', item: drag.name, amount: drag.amount, slot: slotNumber },
                `${drag.amount}x ${drag.label} added to slot ${slotNumber}`,
            );
            return;
        }

        if (drag.slot === slotNumber) return;
        await mutate(
            { action: 'move', fromSlot: drag.slot, toSlot: slotNumber },
            `Slot ${drag.slot} moved to ${slotNumber}`,
        );
    };

    const dropOnTrash = async (e) => {
        e.preventDefault();
        const drag = dragging;
        endDrag();
        if (!drag || drag.kind !== 'slot' || busy) return;

        await mutate(
            { action: 'remove', item: drag.name, amount: drag.amount, slot: drag.slot },
            `${drag.amount}x ${drag.label} removed`,
        );
        setSelected(null);
    };

    const selectedItem = selected != null ? bySlot.get(selected) : null;

    return (
        <div className="sheet" role="dialog" aria-modal="true" aria-label={`Inventory of ${playerName}`}>
            <button className="sheet__backdrop" type="button" aria-label="Close inventory" onClick={onClose} />

            <div className="sheet__panel">
                <header className="sheet__head">
                    <Icon name="box" size={20} className="panel__icon" />
                    <div className="sheet__heading">
                        <h2 className="sheet__title">Inventory — {playerName}</h2>
                        <p className="sheet__sub">
                            {state.status === 'ready'
                                ? `${items.length} of ${maxSlots} slots · ${data.format === 'ox' ? 'ox_inventory' : data.format === 'qb' ? 'qb-inventory' : 'empty'}`
                                : 'Loading…'}
                        </p>
                    </div>
                    <button ref={closeRef} type="button" className="btn btn--ghost btn--sm" onClick={onClose}>
                        Close
                    </button>
                </header>

                <div className="sheet__body">
                    <div>
                        {state.status === 'loading' && <p className="field__hint">Loading inventory…</p>}

                        {state.status === 'error' && (
                            <StatusNote tone="error" title="The inventory could not be loaded" detail={state.error} />
                        )}

                        {state.status === 'ready' && (
                            <div className="grid">
                                {Array.from({ length: maxSlots }, (_, i) => i + 1).map((slotNumber) => (
                                    <Slot
                                        key={slotNumber}
                                        number={slotNumber}
                                        item={bySlot.get(slotNumber)}
                                        draggable={canReorder && !busy}
                                        isSource={dragging?.kind === 'slot' && dragging.slot === slotNumber}
                                        isDrop={dropTarget === slotNumber}
                                        isSelected={selected === slotNumber}
                                        onSelect={() => setSelected(slotNumber)}
                                        onDragStart={startSlotDrag}
                                        onDragEnd={endDrag}
                                        onDragOver={(e) => allowDrop(e, slotNumber)}
                                        onDragLeave={() => setDropTarget((t) => (t === slotNumber ? null : t))}
                                        onDrop={(e) => dropOnSlot(e, slotNumber)}
                                    />
                                ))}
                            </div>
                        )}
                    </div>

                    <aside className="sheet__side">
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
                                    className={`weigh__fill${used > max && max > 0 ? ' weigh__fill--over' : ''}`}
                                    style={{ width: `${pct}%` }}
                                />
                            </div>
                        </div>

                        {!canReorder && (
                            <StatusNote
                                tone="warn"
                                title="Slots cannot be rearranged right now"
                                detail="The player is online and the server owns the live inventory. Adding and removing still work."
                            />
                        )}

                        {selectedItem && (
                            <SlotDetail
                                item={selectedItem}
                                busy={busy}
                                onSet={(amount) => mutate(
                                    { action: 'set', item: selectedItem.name, amount, slot: selectedItem.slot },
                                    `${selectedItem.label} set to ${amount}x`,
                                )}
                                onRemove={() => mutate(
                                    { action: 'remove', item: selectedItem.name, amount: selectedItem.amount, slot: selectedItem.slot },
                                    `${selectedItem.amount}x ${selectedItem.label} removed`,
                                ).then(() => setSelected(null))}
                            />
                        )}

                        <CatalogDrag
                            disabled={busy}
                            onDragItem={setDragging}
                            onDragEnd={endDrag}
                        />

                        <div
                            className={`trash${dropTarget === 'trash' ? ' trash--armed' : ''}`}
                            onDragOver={(e) => allowDrop(e, 'trash')}
                            onDragLeave={() => setDropTarget((t) => (t === 'trash' ? null : t))}
                            onDrop={dropOnTrash}
                        >
                            <Icon name="cross" size={18} />
                            <span>Drop a tile here to remove it</span>
                        </div>

                        {feedback && (
                            <StatusNote tone={feedback.tone} title={feedback.title} detail={feedback.detail} />
                        )}
                    </aside>
                </div>
            </div>
        </div>
    );
}

/* ------------------------------------------------------------------------- */

function Slot({
    number, item, draggable, isSource, isDrop, isSelected,
    onSelect, onDragStart, onDragEnd, onDragOver, onDragLeave, onDrop,
}) {
    const classes = [
        'slot',
        item ? 'slot--filled' : 'slot--empty',
        isSource ? 'slot--source' : '',
        isDrop ? 'slot--drop' : '',
        isSelected ? 'slot--selected' : '',
    ].filter(Boolean).join(' ');

    return (
        <button
            type="button"
            className={classes}
            draggable={Boolean(item) && draggable}
            onDragStart={(e) => item && onDragStart(e, item)}
            onDragEnd={onDragEnd}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            onClick={() => item && onSelect()}
            aria-label={item ? `Slot ${number}: ${item.amount}x ${item.label}` : `Slot ${number}, empty`}
        >
            <span className="slot__num">{number}</span>
            {item && <span className="slot__count u-mono">{item.amount}</span>}

            <span className="slot__art">
                {item && (item.image
                    ? <img className="slot__img" src={item.image} alt="" draggable={false} />
                    : <span className="slot__fallback">{item.name.slice(0, 3)}</span>
                )}
            </span>

            {item && <span className="slot__label">{item.label}</span>}
        </button>
    );
}

function SlotDetail({ item, busy, onSet, onRemove }) {
    const [amount, setAmount] = useState(String(item.amount));
    const parsed = parseAmount(amount);
    const valid = Number.isInteger(parsed) && parsed >= 0;
    const dirty = valid && parsed !== item.amount;

    return (
        <div className="detail">
            <div>
                <div className="detail__name">{item.label}</div>
                <div className="detail__meta">
                    <span className="u-mono">{item.name}</span>
                    <span>Slot {item.slot}</span>
                    {item.unique && <span>Unique</span>}
                    {Number(item.weight) > 0 && <span>{kg(item.weight * item.amount)}</span>}
                </div>
            </div>

            <div className="field">
                <label className="field__label" htmlFor={`slot-amount-${item.slot}`}>Amount</label>
                <input
                    id={`slot-amount-${item.slot}`}
                    className="input u-mono"
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    disabled={busy}
                />
                {!valid && <span className="field__hint">Enter a whole number from 0.</span>}
            </div>

            <div className="detail__actions">
                <button
                    type="button"
                    className="btn btn--primary btn--sm"
                    disabled={!dirty || busy}
                    onClick={() => onSet(parsed)}
                >
                    {busy ? 'Saving…' : 'Set'}
                </button>
                <button
                    type="button"
                    className="btn btn--danger btn--sm"
                    disabled={busy}
                    onClick={onRemove}
                >
                    Remove
                </button>
            </div>
        </div>
    );
}

// Aus dem Katalog wird nicht geklickt, sondern gezogen: dasselbe Verhalten
// wie zwischen zwei Kacheln, damit es nur eine Bedienlogik gibt.
function CatalogDrag({ disabled, onDragItem, onDragEnd }) {
    const [picked, setPicked] = useState(null);
    const [amount, setAmount] = useState('1');

    const parsed = parseAmount(amount);
    const validAmount = Number.isInteger(parsed) && parsed > 0;

    return (
        <div className="detail">
            <CatalogPicker
                id="sheet-item"
                kind="items"
                label="Add from catalog"
                placeholder="Search for an item"
                selected={picked?.key ?? ''}
                selectedLabel={picked ? (picked.label || picked.key) : ''}
                onSelect={setPicked}
                disabled={disabled}
                title={(entry) => entry.label || entry.key}
                meta={(entry) => (entry.unique ? 'unique' : '')}
            />

            <div className="field">
                <label className="field__label" htmlFor="sheet-add-amount">Amount</label>
                <input
                    id="sheet-add-amount"
                    className="input u-mono"
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    disabled={disabled}
                />
            </div>

            <div
                className={`slot slot--filled${picked && validAmount ? '' : ' slot--empty'}`}
                draggable={Boolean(picked) && validAmount && !disabled}
                onDragStart={(e) => {
                    if (!picked || !validAmount) { e.preventDefault(); return; }
                    onDragItem({
                        kind: 'catalog',
                        name: picked.key,
                        label: picked.label || picked.key,
                        amount: parsed,
                    });
                    e.dataTransfer.effectAllowed = 'copy';
                    e.dataTransfer.setData('text/plain', picked.key);
                }}
                onDragEnd={onDragEnd}
            >
                <span className="slot__num">new</span>
                {picked && validAmount && <span className="slot__count u-mono">{parsed}</span>}
                <span className="slot__art">
                    <span className="slot__fallback">
                        {picked ? picked.key.slice(0, 3) : '—'}
                    </span>
                </span>
                <span className="slot__label">
                    {picked && validAmount ? 'Drag onto a slot' : 'Pick an item first'}
                </span>
            </div>
        </div>
    );
}
