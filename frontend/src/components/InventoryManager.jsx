import { useState } from 'react';
import Icon from './Icon';
import StatusNote from './StatusNote';
import CatalogPicker from './CatalogPicker';
import { fetchPlayerInventory, updatePlayerInventory } from '../api';
import { usePlayerResource } from '../lib/usePlayerResource';
import { parseAmount } from '../utils/format';

const modeDetail = (mode) => (mode === 'live'
    ? 'Applied live on the server.'
    : 'The citizen is not connected, so the change went to the database.');

const errorText = (err) => err.response?.data?.error || err.message;

const FORMAT_LABEL = {
    ox: 'ox_inventory',
    qb: 'qb-inventory',
    empty: 'no inventory stored',
};

/**
 * Inventar eines Citizens. Wie bei den Fahrzeugen getrennt in den Bestand
 * (lesen und einzeln korrigieren) und das Einbuchen neuer Items, das eine
 * eigene Suche ueber rund 300 Eintraegen braucht.
 */
export default function InventoryManager({ selectedPlayer, onApplied }) {
    const citizenid = selectedPlayer?.citizenid;
    const [version, setVersion] = useState(0);
    const [listFeedback, setListFeedback] = useState(null);

    const res = usePlayerResource(fetchPlayerInventory, citizenid, version);
    const data = res.data || {};
    const items = Array.isArray(data.items) ? data.items : [];

    const reload = () => setVersion((v) => v + 1);
    const report = (mode, text) => onApplied?.({}, { mode, text });

    return (
        <>
            <section className="panel" aria-labelledby="inv-panel-title">
                <header className="panel__head">
                    <Icon name="box" size={18} className="panel__icon" />
                    <div>
                        <h2 className="panel__title" id="inv-panel-title">Inventory</h2>
                        <p className="panel__hint">{listHint(res, data, items.length)}</p>
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

                    {/* Der Hinweis zum ox-Format ist eine Randbedingung, keine
                        Meldung ueber einen Vorgang: er bleibt dezent. */}
                    {res.status === 'ready' && data.hint && (
                        <p className="field__hint">{data.hint}</p>
                    )}

                    {res.status === 'ready' && items.length === 0 && (
                        <p className="field__hint">
                            {data.format === 'empty'
                                ? 'No inventory is stored for this citizen.'
                                : 'The inventory is empty.'}
                        </p>
                    )}

                    {items.length > 0 && (
                        <ul className={`lines${items.length > 5 ? ' lines--scroll' : ''}`}>
                            {items.map((item) => (
                                <ItemRow
                                    key={`${item.slot}-${item.name}`}
                                    citizenid={citizenid}
                                    item={item}
                                    onFeedback={setListFeedback}
                                    onChanged={reload}
                                    onReport={report}
                                />
                            ))}
                        </ul>
                    )}

                    {listFeedback && (
                        <StatusNote
                            tone={listFeedback.tone}
                            title={listFeedback.title}
                            detail={listFeedback.detail}
                        />
                    )}
                </div>
            </section>

            {res.status !== 'unavailable' && (
                <ItemAdd
                    citizenid={citizenid}
                    disabled={res.status === 'error'}
                    onAdded={reload}
                    onReport={report}
                />
            )}
        </>
    );
}

function listHint(res, data, count) {
    if (res.status === 'loading') return 'Reading the contents';
    if (res.status === 'unavailable') return 'Module unavailable';
    if (res.status === 'error') return 'Contents unknown';

    const format = FORMAT_LABEL[data.format] || data.format || 'unknown format';
    const slots = Number(data.maxSlots);
    const fill = Number.isFinite(slots) && slots > 0
        ? `${count} of ${slots} slots used`
        : `${count} entries`;
    return `${fill} · ${format}`;
}

/* -------------------------------------------------------------------------
   Eine Zeile des Bestands: Menge setzen oder Item entfernen.
   ------------------------------------------------------------------------- */

function ItemRow({ citizenid, item, onFeedback, onChanged, onReport }) {
    const [editing, setEditing] = useState(false);
    const [amount, setAmount] = useState(String(item.amount ?? 0));
    const [confirming, setConfirming] = useState(false);
    const [busy, setBusy] = useState(false);

    const label = item.label || item.name || 'Unknown item';
    // Der Platz allein reicht als Kennung nicht: ox liefert Eintraege auch
    // ohne Slot, und zwei davon duerften dann dasselbe Feld beschriften.
    const fieldId = `inv-amount-${item.slot ?? 'x'}-${item.name ?? 'item'}`;
    const parsed = parseAmount(amount);
    const valid = Number.isFinite(parsed) && parsed >= 0 && Number.isInteger(parsed);
    const isDirty = valid && parsed !== Number(item.amount ?? 0);

    const send = async (change, success, logText) => {
        setBusy(true);
        onFeedback(null);
        try {
            const answer = await updatePlayerInventory(citizenid, change);
            const mode = answer.data?.mode === 'live' ? 'live' : 'offline';

            onFeedback({
                tone: 'success',
                title: answer.data?.message || success,
                detail: modeDetail(mode),
            });
            onReport(mode, logText);
            setEditing(false);
            onChanged();
        } catch (err) {
            setConfirming(false);
            onFeedback({
                tone: 'error',
                title: 'The inventory could not be changed',
                detail: errorText(err),
            });
        } finally {
            setBusy(false);
        }
    };

    return (
        <li className="line">
            <div className="line__top">
                {item.slot != null && <span className="line__slot u-mono">#{item.slot}</span>}
                <span className="line__name">{label}</span>
                <span className="pill line__badge u-mono">{item.amount ?? 0}×</span>
            </div>

            <div className="line__meta">
                <span className="u-mono">{item.name}</span>
                {Number.isFinite(Number(item.weight)) && <span>Weight {Math.round(Number(item.weight))}</span>}
                {item.unique && <span>Unique</span>}
                {item.metadata && Object.keys(item.metadata).length > 0 && <span>has metadata</span>}
            </div>

            {editing && (
                <div className="line__edit">
                    <div className="field">
                        <label className="field__label" htmlFor={fieldId}>New amount</label>
                        <input
                            id={fieldId}
                            className="input u-mono"
                            type="text"
                            inputMode="numeric"
                            autoComplete="off"
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                            disabled={busy}
                        />
                        <span className="field__hint">
                            {valid ? `Currently ${item.amount ?? 0}×` : 'Enter a whole number from 0.'}
                        </span>
                    </div>
                </div>
            )}

            {confirming && (
                <p className="line__meta">Removing clears all {item.amount ?? 0} from this slot.</p>
            )}

            <div className="line__actions">
                {editing ? (
                    <>
                        <button
                            type="button"
                            className="btn btn--primary btn--sm"
                            onClick={() => send(
                                { action: 'set', item: item.name, amount: parsed, slot: item.slot },
                                `${label} set to ${parsed}×`,
                                `${label} set to ${parsed}×`,
                            )}
                            disabled={!isDirty || busy}
                        >
                            {busy ? 'Saving…' : 'Set amount'}
                        </button>
                        <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            onClick={() => { setEditing(false); setAmount(String(item.amount ?? 0)); }}
                            disabled={busy}
                        >
                            Cancel
                        </button>
                    </>
                ) : (
                    <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() => {
                            setAmount(String(item.amount ?? 0));
                            setEditing(true);
                            setConfirming(false);
                            onFeedback(null);
                        }}
                        disabled={busy}
                    >
                        Change amount
                    </button>
                )}

                {confirming ? (
                    <>
                        <button
                            type="button"
                            className="btn btn--danger btn--sm"
                            onClick={() => send(
                                { action: 'remove', item: item.name, amount: Number(item.amount ?? 0), slot: item.slot },
                                `${label} removed`,
                                `${label} removed`,
                            )}
                            disabled={busy}
                        >
                            {busy ? 'Removing…' : 'Really remove'}
                        </button>
                        <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            onClick={() => setConfirming(false)}
                            disabled={busy}
                        >
                            Keep
                        </button>
                    </>
                ) : (
                    <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() => { setConfirming(true); onFeedback(null); }}
                        disabled={busy}
                    >
                        Remove
                    </button>
                )}
            </div>
        </li>
    );
}

/* -------------------------------------------------------------------------
   Zweite Karte: ein Item einbuchen.
   ------------------------------------------------------------------------- */

function ItemAdd({ citizenid, disabled, onAdded, onReport }) {
    const [item, setItem] = useState(null); // { key, label, weight, unique }
    const [amount, setAmount] = useState('1');
    const [slot, setSlot] = useState('');
    const [saving, setSaving] = useState(false);
    const [feedback, setFeedback] = useState(null);

    const parsed = parseAmount(amount);
    const validAmount = Number.isFinite(parsed) && Number.isInteger(parsed) && parsed > 0;
    const parsedSlot = slot.trim() === '' ? null : parseAmount(slot);
    const validSlot = parsedSlot === null || (Number.isInteger(parsedSlot) && parsedSlot > 0);
    const canSave = Boolean(item) && validAmount && validSlot && !saving && !disabled;

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!canSave) return;

        setSaving(true);
        setFeedback(null);
        try {
            const answer = await updatePlayerInventory(citizenid, {
                action: 'add',
                item: item.key,
                amount: parsed,
                slot: parsedSlot ?? undefined,
            });
            const mode = answer.data?.mode === 'live' ? 'live' : 'offline';
            const label = item.label || item.key;

            setFeedback({
                tone: 'success',
                title: answer.data?.message || `${parsed}× ${label} added`,
                detail: modeDetail(mode),
            });
            setAmount('1');
            setSlot('');
            onReport(mode, `${parsed}× ${label} added`);
            onAdded();
        } catch (err) {
            setFeedback({
                tone: 'error',
                title: 'The item could not be added',
                detail: errorText(err),
            });
        } finally {
            setSaving(false);
        }
    };

    return (
        <section className="panel" aria-labelledby="inv-add-title">
            <header className="panel__head">
                <Icon name="plus" size={18} className="panel__icon" />
                <div>
                    <h2 className="panel__title" id="inv-add-title">Add item</h2>
                    <p className="panel__hint">Pick an item from the catalog</p>
                </div>
            </header>

            <form className="panel__form" onSubmit={handleSubmit}>
                <div className="panel__body">
                    <CatalogPicker
                        id="inv-item"
                        kind="items"
                        label="Item"
                        placeholder="Search for an item"
                        selected={item?.key ?? ''}
                        selectedLabel={item ? `${item.label || item.key}` : ''}
                        onSelect={(entry) => { setItem(entry); setFeedback(null); }}
                        disabled={saving || disabled}
                        title={(entry) => entry.label || entry.key}
                        meta={(entry) => (entry.unique ? 'unique' : '')}
                    />

                    <div className="panel__row">
                        <div className="field">
                            <label className="field__label" htmlFor="inv-add-amount">Amount</label>
                            <input
                                id="inv-add-amount"
                                className="input u-mono"
                                type="text"
                                inputMode="numeric"
                                autoComplete="off"
                                value={amount}
                                onChange={(e) => { setAmount(e.target.value); setFeedback(null); }}
                                disabled={saving || disabled}
                            />
                            {!validAmount && <span className="field__hint">Enter a whole number from 1.</span>}
                        </div>

                        <div className="field">
                            <label className="field__label" htmlFor="inv-add-slot">Slot</label>
                            <input
                                id="inv-add-slot"
                                className="input u-mono"
                                type="text"
                                inputMode="numeric"
                                autoComplete="off"
                                placeholder="auto"
                                value={slot}
                                onChange={(e) => { setSlot(e.target.value); setFeedback(null); }}
                                disabled={saving || disabled}
                            />
                            <span className="field__hint">
                                {validSlot ? 'Leave empty for the next free slot.' : 'Enter a whole number from 1.'}
                            </span>
                        </div>
                    </div>

                    {feedback && (
                        <StatusNote tone={feedback.tone} title={feedback.title} detail={feedback.detail} />
                    )}
                </div>

                <footer className="panel__foot">
                    <span className="panel__footinfo">
                        {item && validAmount ? `${parsed}× ${item.label || item.key}` : 'Nothing selected'}
                    </span>
                    <button type="submit" className="btn btn--primary" disabled={!canSave}>
                        {saving ? 'Adding…' : 'Add item'}
                    </button>
                </footer>
            </form>
        </section>
    );
}
