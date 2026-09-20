import { useState } from 'react';
import StatusNote from './StatusNote';
import { useCatalog, CATALOG_LIMIT } from '../lib/useCatalog';

/**
 * Auswahl aus einem der grossen Stammdatenkataloge (Items, Fahrzeuge).
 *
 * Bewusst kein <select>: bei rund 900 Fahrzeugen waere eine Klappliste weder
 * ladbar noch bedienbar. Stattdessen ein Suchfeld, das serverseitig filtert,
 * und darunter dieselbe Leiter, die im Job-Modul die Raenge traegt.
 *
 * Die getroffene Wahl bleibt sichtbar, auch wenn sie durch eine neue Suche
 * aus der Trefferliste faellt - sonst waere nicht mehr erkennbar, was beim
 * Abschicken eigentlich gesendet wird.
 */
export default function CatalogPicker({
    id,
    kind,
    label,
    placeholder,
    selected,
    selectedLabel,
    onSelect,
    disabled = false,
    title,
    meta,
}) {
    const [search, setSearch] = useState('');
    const catalog = useCatalog(kind, search);

    const listId = `${id}-list`;
    const waiting = catalog.query === null;

    return (
        <div className="field">
            <label className="field__label" htmlFor={id}>{label}</label>
            <input
                id={id}
                className="input"
                type="search"
                autoComplete="off"
                placeholder={placeholder}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                disabled={disabled}
                aria-controls={listId}
            />

            {catalog.status === 'error' ? (
                <StatusNote
                    tone="error"
                    title="The catalog could not be loaded"
                    detail={catalog.error}
                />
            ) : (
                <>
                    {waiting && <p className="field__hint">Loading catalog…</p>}

                    {!waiting && catalog.results.length === 0 && (
                        <p className="field__hint">
                            {catalog.query
                                ? `No match for “${catalog.query}”.`
                                : 'The catalog is empty.'}
                        </p>
                    )}

                    {catalog.results.length > 0 && (
                        <div
                            className={`ladder${catalog.isStale ? ' is-stale' : ''}`}
                            id={listId}
                            role="listbox"
                            aria-label={label}
                            aria-busy={catalog.isStale}
                        >
                            {catalog.results.map((entry) => {
                                const active = entry.key === selected;
                                return (
                                    <button
                                        key={entry.key}
                                        type="button"
                                        role="option"
                                        aria-selected={active}
                                        className={`ladder__step${active ? ' is-active' : ''}`}
                                        onClick={() => onSelect(entry)}
                                        disabled={disabled}
                                    >
                                        <span className="ladder__name">{title(entry)}</span>
                                        {meta && <span className="ladder__now u-mono">{meta(entry)}</span>}
                                    </button>
                                );
                            })}
                        </div>
                    )}

                    {!waiting && (
                        <span className="field__hint">
                            {catalog.truncated
                                ? `${catalog.matched} matches, showing the first ${CATALOG_LIMIT} — narrow the search.`
                                : `${catalog.matched} of ${catalog.total} entries.`}
                        </span>
                    )}
                </>
            )}

            <div className="preview">
                <span className="preview__label u-caps">Selected</span>
                <span className={selected ? 'preview__value u-mono' : 'preview__value preview__value--empty'}>
                    {selected ? (selectedLabel || selected) : 'Nothing selected yet'}
                </span>
            </div>
        </div>
    );
}
