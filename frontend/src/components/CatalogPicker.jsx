import { useState } from 'react';
import StatusNote from './StatusNote';
import { useCatalog, CATALOG_LIMIT } from '../lib/useCatalog';

/**
 * Selection from one of the large reference catalogs (items, vehicles).
 *
 * Deliberately not a <select>: with around 900 vehicles a dropdown would be
 * neither loadable nor operable. Instead a search field that filters on the
 * server, and below it the same ladder that carries grades in the job module.
 *
 * The choice made stays visible even when a new search drops it out of the
 * result list - otherwise it would no longer be clear what actually gets
 * sent on submit.
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
