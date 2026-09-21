import { useRef } from 'react';
import Icon from './Icon';

/**
 * The section bar above the module wall.
 *
 * Reason: without it, up to thirteen cards stood stacked at once - job,
 * money, inventory, vehicles, licenses, status, character data,
 * memberships, accounts, live actions, position, bans. Changing one thing
 * meant scrolling past all the others. Now only one section stands there at
 * a time, and which one it is survives a change of citizen - correcting ten
 * balances in a row keeps you in "Money" instead of clicking your way back
 * there every time.
 *
 * Only sections with visible content are offered: an empty section would be
 * a dead end that explains nothing.
 *
 * The server area uses the same bar and passes its own `label`. Two bars
 * that looked alike but walked differently under the arrow keys would be
 * worse than one shared one.
 */
export default function CitizenTabs({ tabs, activeId, onSelect, label = 'Citizen sections' }) {
    const listRef = useRef(null);

    // Arrow keys walk through the bar, as expected of a tab bar.
    const handleKeyDown = (event) => {
        const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
        if (step === 0) return;

        event.preventDefault();
        const index = tabs.findIndex((tab) => tab.id === activeId);
        const next = tabs[(index + step + tabs.length) % tabs.length];
        onSelect(next.id);
        // Carry the focus along, otherwise it stays on the old tab.
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

                            {/* The dot states only something verified: this
                                citizen is on the server right now, so the
                                actions in this section take effect at once. */}
                            {tab.live && <span className="tab__live" aria-hidden="true" />}
                            {tab.live && <span className="u-sr">— citizen is on the server</span>}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
