import { useCallback, useEffect, useRef, useState } from 'react';
import Amount from './Amount';
import Icon from './Icon';
import PermissionLine from './PermissionLine';
import StatusNote from './StatusNote';
import CatalogPicker from './CatalogPicker';
import { fetchPlayerInventory, updatePlayerInventory } from '../api';
import { parseAmount } from '../utils/format';

// Up to 9,999 a count fits the corner of a slot as it is; past that it is
// shortened ("12.3K") rather than running into the slot number.
const SLOT_COMPACT_FROM = 10000;

const errorText = (err) => err.response?.data?.error || err.message;

const modeDetail = (mode) => (mode === 'live'
    ? 'Applied live on the server.'
    : 'The citizen is not connected, so the change went to the database.');

// Raw grams are unreadable; ox_inventory itself shows kilograms.
function kg(grams) {
    const n = Number(grams) || 0;
    return `${(n / 1000).toFixed(2)} kg`;
}

/**
 * The inventory as a grid, modelled on the one in the game.
 *
 * The tiles are real controls: dragging moves, swaps or merges, dropping on
 * the bin books out, the catalog on the right puts new items in. What counts
 * in the end is always decided by the backend - the answer to every mutation
 * carries the new layout, and that is exactly what is displayed. Nothing is
 * anticipated optimistically, otherwise after a rejected move the grid would
 * show a state that does not exist.
 */
export default function InventorySheet({ citizenid, playerName, canEdit = false, onClose, onApplied }) {
    const [state, setState] = useState({ status: 'loading', data: null, error: null });
    const [feedback, setFeedback] = useState(null);
    const [busy, setBusy] = useState(false);
    const [dragging, setDragging] = useState(null); // { kind: 'slot'|'catalog', ... }
    const [dropTarget, setDropTarget] = useState(null); // slot number or 'trash'
    const [selected, setSelected] = useState(null); // slot number
    const closeRef = useRef(null);

    // First load. The cancelled flag keeps a late answer from writing into
    // a sheet that has already been closed.
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

    // Escape closes. On opening, focus lands on the close button so that
    // keyboard operation does not carry on behind the sheet.
    useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        closeRef.current?.focus();
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    const data = state.data || {};
    const items = Array.isArray(data.items) ? data.items : [];
    const maxSlots = Number(data.maxSlots) || 41;
    // Two reasons why nothing can be moved, and they must not be confused:
    // the server is holding the inventory itself right now (serverLocked),
    // or one's own role may not (canEdit). Both lock the same tiles, but
    // each of them needs its own sentence.
    const serverLocked = data.canReorder === false;
    const canReorder = canEdit && !serverLocked;

    const bySlot = new Map(items.map((it) => [it.slot, it]));
    const used = Number(data.totalWeight) || 0;
    const max = Number(data.maxWeight) || 0;
    const pct = max > 0 ? Math.min(100, (used / max) * 100) : 0;

    // Every mutation runs through here: either the answer carries the new
    // layout (offline route), or we fetch it afterwards (live route, where
    // only the server knows the result).
    const mutate = useCallback(async (change, logText) => {
        // Last barrier in the frontend. The backend rejects it anyway; this
        // one is here so a drag that slipped through does not even look
        // like an operation.
        if (!canEdit) return false;

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
    }, [canEdit, citizenid, onApplied]);

    // --- Drag and drop -----------------------------------------------------

    const startSlotDrag = (e, item) => {
        if (!canReorder || busy) { e.preventDefault(); return; }
        setDragging({ kind: 'slot', slot: item.slot, name: item.name, label: item.label, amount: item.amount });
        e.dataTransfer.effectAllowed = 'move';
        // Without data set, Firefox does not start a drag at all.
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

                        {/* Once per sheet, right at the top of the column:
                            the reason why nothing works below. */}
                        {!canEdit && <PermissionLine what="add, remove or move items" />}

                        {canEdit && serverLocked && (
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
                                canEdit={canEdit}
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

                        {canEdit && (
                            <CatalogAdd
                                disabled={busy}
                                onAdd={(name, amount, label) => mutate(
                                    { action: 'add', item: name, amount },
                                    `${amount}x ${label} added`,
                                )}
                                onDragItem={setDragging}
                                onDragEnd={endDrag}
                            />
                        )}

                        {/* The bin stays even without the permission: it is
                            part of explaining the grid. Without the
                            permission no tile can be picked up at all, so
                            nothing ever reaches it. */}
                        <div
                            className={`trash${dropTarget === 'trash' ? ' trash--armed' : ''}`}
                            onDragOver={(e) => allowDrop(e, 'trash')}
                            onDragLeave={() => setDropTarget((t) => (t === 'trash' ? null : t))}
                            onDrop={dropOnTrash}
                        >
                            <Icon name="cross" size={18} />
                            <span>
                                {canEdit
                                    ? 'Drop a tile here to remove it'
                                    : 'Removing items needs inventory.edit'}
                            </span>
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
            {/* The count shares the slot's top edge with the slot number,
                and a five-slot row leaves a phone about 3rem per slot: from
                ten thousand on it goes compact. The exact count is in the
                slot's aria-label and in the title of its name below. */}
            {item && (
                <Amount
                    value={item.amount}
                    currency={false}
                    compactFrom={SLOT_COMPACT_FROM}
                    className="slot__count u-mono"
                />
            )}

            <span className="slot__art">
                {item && (item.image
                    ? <img className="slot__img" src={item.image} alt="" draggable={false} />
                    : <span className="slot__fallback">{item.name.slice(0, 3)}</span>
                )}
            </span>

            {item && <span className="slot__label" title={`${item.amount}× ${item.label}`}>{item.label}</span>}
        </button>
    );
}

function SlotDetail({ item, busy, canEdit, onSet, onRemove }) {
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
                    disabled={busy || !canEdit}
                />
                {!valid && <span className="field__hint">Enter a whole number from 0.</span>}
            </div>

            <div className="detail__actions">
                <button
                    type="button"
                    className="btn btn--primary btn--sm"
                    disabled={!dirty || busy || !canEdit}
                    onClick={() => onSet(parsed)}
                >
                    {busy ? 'Saving…' : 'Set'}
                </button>
                <button
                    type="button"
                    className="btn btn--danger btn--sm"
                    disabled={busy || !canEdit}
                    onClick={onRemove}
                >
                    Remove
                </button>
            </div>
        </div>
    );
}

// Two ways in, on purpose.
//
// The button is the plain one: it hands the item to the backend without a
// slot, and the backend drops it on the first free one. Dragging is for
// when the slot matters. Everything else in this sheet has a button, and
// adding being drag-only made it look broken to anyone who did not think
// to drag a tile.
function CatalogAdd({ disabled, onAdd, onDragItem, onDragEnd }) {
    const [picked, setPicked] = useState(null);
    const [amount, setAmount] = useState('1');

    const parsed = parseAmount(amount);
    const validAmount = Number.isInteger(parsed) && parsed > 0;
    const ready = Boolean(picked) && validAmount && !disabled;

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
                className={`slot slot--filled${ready ? '' : ' slot--empty'}`}
                draggable={ready}
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
                {picked && validAmount && (
                    <Amount value={parsed} currency={false} compactFrom={SLOT_COMPACT_FROM} className="slot__count u-mono" />
                )}
                <span className="slot__art">
                    <span className="slot__fallback">
                        {picked ? picked.key.slice(0, 3) : '—'}
                    </span>
                </span>
                <span className="slot__label">
                    {ready ? 'Drag onto a slot' : 'Pick an item first'}
                </span>
            </div>

            <button
                type="button"
                className="btn btn--primary btn--sm"
                disabled={!ready}
                onClick={() => onAdd(picked.key, parsed, picked.label || picked.key)}
            >
                {disabled ? 'Working…' : 'Add to inventory'}
            </button>
            <span className="field__hint">
                Lands on the first free slot. Drag the tile above instead to
                choose the slot yourself.
            </span>
        </div>
    );
}
