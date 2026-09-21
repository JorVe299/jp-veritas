import AccountsPanel from './AccountsPanel';
import BansPanel from './BansPanel';
import CitizenTabs from './CitizenTabs';
import DiagnosticsPanel from './DiagnosticsPanel';
import OrganisationsPanel from './OrganisationsPanel';
import ResourcesPanel from './ResourcesPanel';
import TxAdminBansPanel from './TxAdminBansPanel';

/**
 * The second main area: everything on this server that belongs to nobody.
 *
 * The panel was built entirely around one citizen - pick a character, then
 * change something about them. Several things do not fit that shape at all.
 * A police force has a balance and a headcount whether or not anyone is
 * looking at an officer. The ban list hangs off licenses and Discord IDs,
 * some of which no character in the database belongs to. The resources and
 * the schema belong to the installation. None of those is a further card in
 * the citizen wall, because a card there claims by its position that its
 * contents belong to the selected character.
 *
 * The order of the sections follows how far each one reaches, from reading
 * about the world the players live in to reaching into the running game
 * server:
 *
 *   Organisations - the bodies players belong to
 *   Accounts      - the money those bodies and people hold
 *   Bans          - who is kept out, in both of the records that keep it
 *   Resources     - the code the game server runs, and calling into it
 *   Diagnostics   - what this installation is, when something is wrong
 *
 * The tab bar is the same component the citizen view uses. Two bars that
 * look alike but behave differently would be worse than one shared one.
 */
export default function ServerArea({ tabs, activeTab, onTabChange }) {
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
                /* Resources stacks instead of laying out in columns: its
                   three cards climb from harmless to dangerous, and that
                   order only reads if they sit one under the other. Bans
                   stacks for a different reason: its two cards are two
                   different records of who is kept out, and side by side at
                   equal width they would read as one list in two columns -
                   which is the one thing that area may not say. */
                className={`modules${activeTab === 'resources' || activeTab === 'bans' ? ' modules--stack' : ''}`}
                role="tabpanel"
                id={`tabpanel-${activeTab}`}
                aria-labelledby={`tab-${activeTab}`}
                tabIndex={-1}
            >
                {activeTab === 'orgs' && <OrganisationsPanel />}
                {activeTab === 'accounts' && <AccountsPanel />}
                {activeTab === 'bans' && (
                    <>
                        <BansPanel />
                        <TxAdminBansPanel />
                    </>
                )}
                {activeTab === 'resources' && <ResourcesPanel />}
                {activeTab === 'system' && <DiagnosticsPanel />}
            </div>
        </>
    );
}
