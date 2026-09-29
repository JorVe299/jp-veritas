import { useRef } from 'react';
import Icon from './Icon';

/** Section tab bar with arrow-key navigation; shared by the citizen and server areas */
export default function CitizenTabs({ tabs, activeId, onSelect, label = 'Citizen sections' }) {
    const listRef = useRef(null);

    const handleKeyDown = (event) => {
        const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
        if (step === 0) return;

        event.preventDefault();
        const index = tabs.findIndex((tab) => tab.id === activeId);
        const next = tabs[(index + step + tabs.length) % tabs.length];
        onSelect(next.id);
        // Roving tabindex: focus must follow the selection
        listRef.current
            ?.querySelector(`[data-tab="${next.id}"]`)
            ?.focus();
    };

    return (
        <div className="tabs">
            <div
                className="tabs__list"
                role="tablist"
                aria-label={label}
                ref={listRef}
                onKeyDown={handleKeyDown}
            >
                {tabs.map((tab) => {
                    const active = tab.id === activeId;
                    return (
                        <button
                            key={tab.id}
                            type="button"
                            role="tab"
                            data-tab={tab.id}
                            id={`tab-${tab.id}`}
                            aria-selected={active}
                            aria-controls={`tabpanel-${tab.id}`}
                            tabIndex={active ? 0 : -1}
                            className={`tab${active ? ' is-active' : ''}`}
                            onClick={() => onSelect(tab.id)}
                        >
                            <Icon name={tab.icon} size={16} className="tab__icon" />
                            <span className="tab__label">{tab.label}</span>

                            {/* Verified presence only: actions here apply at once */}
                            {tab.live && <span className="tab__live" aria-hidden="true" />}
                            {tab.live && <span className="u-sr">— citizen is on the server</span>}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
