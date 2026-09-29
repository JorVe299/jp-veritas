import AccountsPanel from './AccountsPanel';
import AllBansPanel from './AllBansPanel';
import CitizenTabs from './CitizenTabs';
import DiagnosticsPanel from './DiagnosticsPanel';
import OrganisationsPanel from './OrganisationsPanel';

/**
 * Server area: what belongs to no citizen (organisations, accounts, bans, diagnostics)
 * Not citizen-wall cards: a card there implies it belongs to the selected character
 * Same tab bar as the citizen area: look-alike bars must not behave differently
 */
export default function ServerArea({
    tabs,
    activeTab,
    onTabChange,
    bansCitizenid = '',
    onClearBansCitizen,
}) {
    return (
        <>
            <header className="areahead">
                <h1 className="areahead__title u-display">Server</h1>
                <p className="areahead__lede">
                    The things here belong to the server rather than to any one citizen —
                    the organisations players work for, the money those hold, everyone kept
                    out, and what this installation is actually running.
                </p>
            </header>

            <CitizenTabs
                tabs={tabs}
                activeId={activeTab}
                onSelect={onTabChange}
                label="Server sections"
            />

            <div
                /* Bans stacks: its wide rows become unscannable in a grid column */
                className={`modules${activeTab === 'bans' ? ' modules--stack' : ''}`}
                role="tabpanel"
                id={`tabpanel-${activeTab}`}
                aria-labelledby={`tab-${activeTab}`}
                tabIndex={-1}
            >
                {activeTab === 'orgs' && <OrganisationsPanel />}
                {activeTab === 'accounts' && <AccountsPanel />}
                {activeTab === 'bans' && (
                    <AllBansPanel
                        citizenid={bansCitizenid}
                        onClearCitizen={onClearBansCitizen}
                    />
                )}
                {activeTab === 'system' && <DiagnosticsPanel />}
            </div>
        </>
    );
}
