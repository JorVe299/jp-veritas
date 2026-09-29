import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchGangs, fetchJobs } from '../api';
import AccountManager from './AccountManager';
import BanManager from './BanManager';
import Billboard from './Billboard';
import CitizenTabs from './CitizenTabs';
import CitizenWall from './CitizenWall';
import GroupManager from './GroupManager';
import HomeArea from './HomeArea';
import Icon from './Icon';
import InventoryManager from './InventoryManager';
import JobManager from './JobManager';
import LiveActionsManager from './LiveActionsManager';
import MoneyManager from './MoneyManager';
import PermissionsSheet from './PermissionsSheet';
import PlayerDataManager from './PlayerDataManager';
import ServerArea from './ServerArea';
import VehicleManager from './VehicleManager';
import StatusNote from './StatusNote';
import TopBar from './TopBar';
import { PlateSprite } from './Plate';
import { useRoster } from '../lib/useRoster';
import { buildPermissions, CanContext } from '../lib/useCan';
import { formatTime } from '../utils/format';

const LOG_LIMIT = 6;

const SERVER_HINTS = {
    orgs: 'The jobs and gangs players belong to, and who is in them.',
    accounts: 'Every account on this server, personal and company.',
    bans: 'Everyone kept out, including identifiers with no character.',
    system: 'What this installation is, when something looks wrong.',
};

const OPEN_PANEL_WARNING =
    'Discord login is not configured - this panel is open to anyone who can reach it.';

/**
 * Panel shell; mounted only after the session is confirmed (or auth is off): no early 401s
 * Cards lacking their view permission are not mounted: a first-load 403 would read as a fault
 * Cards are keyed per citizen: every form restarts when the selection changes
 */
export default function Workspace({
    user,
    authDisabled,
    warning,
    signingOut,
    onSignOut,
    permissionNotice = false,
    onDismissPermissionNotice,
    onPermissionsChanged,
    onOpenPortal,
}) {
    const [search, setSearch] = useState('');
    const [page, setPage] = useState(1);
    const [selectedPlayer, setSelectedPlayer] = useState(null);
    const [rosterVersion, setRosterVersion] = useState(0);
    const [jobs, setJobs] = useState({});
    const [jobsError, setJobsError] = useState(null);
    const [gangs, setGangs] = useState({});
    const [gangsError, setGangsError] = useState(null);
    const [writeLog, setWriteLog] = useState([]);
    const [permissionsOpen, setPermissionsOpen] = useState(false);
    // Survives citizen changes: correcting balances in a row stays in "Money"
    const [tab, setTab] = useState('identity');

    // Plain state, no router: no deep links to keep
    const [area, setArea] = useState('citizens');
    const [serverTab, setServerTab] = useState('orgs');

    // Lifted here: set from the Enforcement tab, cleared from the server ban list
    const [bansCitizenid, setBansCitizenid] = useState('');

    // Keyed on user: a session reload updates every card's permissions, no re-login
    const permissions = useMemo(
        () => buildPermissions(user, authDisabled),
        [user, authDisabled],
    );
    const { can } = permissions;

    const canViewPlayers = can('players.view');
    const canEditPermissions = can('permissions.edit');

    const roster = useRoster(search, page, rosterVersion, canViewPlayers);
    const stageRef = useRef(null);

    // Once per session; /api/meta/* requires players.view, so not requested without it
    useEffect(() => {
        if (!canViewPlayers) return undefined;

        let cancelled = false;
        fetchJobs()
            .then((res) => { if (!cancelled) setJobs(res.data || {}); })
            .catch((err) => {
                if (!cancelled) setJobsError(err.response?.data?.error || err.message);
            });
        return () => { cancelled = true; };
    }, [canViewPlayers]);

    useEffect(() => {
        if (!canViewPlayers) return undefined;

        let cancelled = false;
        fetchGangs()
            .then((res) => { if (!cancelled) setGangs(res.data || {}); })
            .catch((err) => {
                if (!cancelled) setGangsError(err.response?.data?.error || err.message);
            });
        return () => { cancelled = true; };
    }, [canViewPlayers]);

    const handleSearchChange = useCallback((value) => {
        setSearch(value);
        setPage(1);
    }, []);

    // Scroll up on select: billboard and cards land in one field of view
    const handleSelect = useCallback((player) => {
        setSelectedPlayer(player);
        setWriteLog([]);
        stageRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    }, []);

    const handleApplied = useCallback((patch, entry) => {
        setSelectedPlayer((prev) => (prev ? { ...prev, ...patch } : prev));
        setRosterVersion((v) => v + 1);
        if (entry) {
            setWriteLog((prev) => [
                { id: `${Date.now()}-${prev.length}`, time: formatTime(), ...entry },
                ...prev,
            ].slice(0, LOG_LIMIT));
        }
    }, []);

    const bridgeDown = Boolean(roster.bridge && !roster.bridge.reachable);
    const warned = authDisabled || permissionNotice;

    // Online only counts while the bridge answers; otherwise unknown, never claimed
    const onlineNow = Boolean(selectedPlayer?.isOnline && !bridgeDown);

    // Licences and character data have separate permissions; either one fills the card
    const canSeeCharacterData = can('metadata.view') || can('charinfo.edit');

    // Only sections the user can see: an empty section explains nothing
    const tabs = useMemo(() => {
        const list = [
            { id: 'identity', label: 'Identity', icon: 'id' },
            { id: 'money', label: 'Money', icon: 'cash' },
        ];

        if (can('inventory.view') || can('vehicles.view')) {
            list.push({ id: 'assets', label: 'Assets', icon: 'box' });
        }

        list.push({ id: 'session', label: 'Session', icon: 'bolt', live: onlineNow });

        if (can('bans.view')) {
            list.push({ id: 'enforcement', label: 'Enforcement', icon: 'ban' });
        }

        return list;
    }, [can, onlineNow]);

    // Derived, not synced: losing a permission falls back to the first tab without an effect
    const activeTab = tabs.some((t) => t.id === tab) ? tab : tabs[0].id;

    // Same mount rule as the cards; system.view also covers the framework probe
    const serverTabs = useMemo(() => {
        const list = [];

        if (can('orgs.view')) list.push({ id: 'orgs', label: 'Organisations', icon: 'briefcase' });
        if (can('accounts.view')) list.push({ id: 'accounts', label: 'Accounts', icon: 'bank' });
        if (can('bans.view')) list.push({ id: 'bans', label: 'Bans', icon: 'ban' });
        if (can('system.view')) list.push({ id: 'system', label: 'Diagnostics', icon: 'pulse' });

        return list;
    }, [can]);

    // No server section: no server area, and so no area switch
    const areas = useMemo(() => {
        const list = [{ id: 'citizens', label: 'Citizens', icon: 'users' }];
        if (serverTabs.length > 0) list.push({ id: 'server', label: 'Server', icon: 'server' });
        return list;
    }, [serverTabs]);

    // Derived like activeTab: losing the last server permission falls back to citizens
    const activeArea = area === 'home' || areas.some((a) => a.id === area)
        ? area
        : 'citizens';
    const activeServerTab = serverTabs.some((t) => t.id === serverTab)
        ? serverTab
        : serverTabs[0]?.id;

    // Back to the top: areas differ in height; a kept offset would land mid-card
    const handleAreaChange = useCallback((next) => {
        setArea(next);
        stageRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    }, []);

    const handleSelectFromHome = useCallback((player) => {
        handleSelect(player);
        setArea('citizens');
    }, [handleSelect]);

    // The account card links to the server-wide list instead of holding a copy
    const showAllAccounts = useCallback(() => {
        setServerTab('accounts');
        handleAreaChange('server');
    }, [handleAreaChange]);

    const serverAccountsReachable = serverTabs.some((t) => t.id === 'accounts');

    // Same for bans: the card sees only this character's DB bans; the server list holds
    // both ban records and identifier-only entries, so link there, filtered to the citizen
    const showBansForCitizen = useCallback(() => {
        const citizenid = selectedPlayer?.citizenid;
        if (!citizenid) return;
        setBansCitizenid(citizenid);
        setServerTab('bans');
        handleAreaChange('server');
    }, [selectedPlayer, handleAreaChange]);

    const clearBansCitizen = useCallback(() => setBansCitizenid(''), []);

    const serverBansReachable = serverTabs.some((t) => t.id === 'bans');

    // Plain data, no callbacks: a closure here would capture the scroll ref (React warning)
    const destinations = useMemo(() => {
        const list = [];

        if (canViewPlayers) {
            list.push({
                id: 'citizens',
                label: 'Citizens',
                icon: 'users',
                hint: 'Search the roster and change a record, online or not.',
                area: 'citizens',
            });
        }

        serverTabs.forEach((t) => {
            list.push({
                id: `server-${t.id}`,
                label: t.label,
                icon: t.icon,
                hint: SERVER_HINTS[t.id] || '',
                area: 'server',
                serverTab: t.id,
            });
        });

        return list;
    }, [canViewPlayers, serverTabs]);

    const handleGoDestination = useCallback((dest) => {
        if (dest.serverTab) setServerTab(dest.serverTab);
        handleAreaChange(dest.area);
    }, [handleAreaChange]);

    // Only the loaded page's online players; the start page flags a higher bridge count
    const onlinePlayers = useMemo(
        () => (bridgeDown ? [] : roster.players.filter((p) => p.isOnline)),
        [roster.players, bridgeDown],
    );

    return (
        <CanContext.Provider value={permissions}>
            <div className={`app${warned ? ' app--warned' : ''}`}>
                <PlateSprite />

                <TopBar
                    search={search}
                    onSearchChange={handleSearchChange}
                    searchable={canViewPlayers}
                    areas={areas}
                    activeArea={activeArea}
                    onAreaChange={handleAreaChange}
                    atHome={activeArea === 'home'}
                    onGoHome={() => handleAreaChange('home')}
                    bridge={roster.bridge}
                    status={roster.status}
                    user={user}
                    roleLabel={permissions.roleLabel}
                    showSession={!authDisabled}
                    showPermissions={canEditPermissions}
                    onOpenPermissions={() => setPermissionsOpen(true)}
                    onOpenPortal={onOpenPortal}
                    signingOut={signingOut}
                    onSignOut={onSignOut}
                />

                {/* One shared grid row outside the stage: two banners must not starve it */}
                {warned && (
                    <div className="banners">
                        {/* Not dismissible: anyone who can reach the port can create money */}
                        {authDisabled && (
                            <StatusNote
                                className="banner"
                                tone="warn"
                                title="Anyone who can reach this panel can use it"
                                detail={warning || OPEN_PANEL_WARNING}
                            />
                        )}

                        {/* Once here, not per card: the cards only see an unexplained 403 */}
                        {permissionNotice && (
                            <div className="banner banner--perm" role="status">
                                <Icon name="info" size={16} />
                                <span className="banner__text">
                                    Your permissions changed — some actions are no longer available.
                                </span>
                                <button
                                    type="button"
                                    className="btn btn--ghost btn--sm"
                                    onClick={onDismissPermissionNotice}
                                >
                                    Dismiss
                                </button>
                            </div>
                        )}
                    </div>
                )}

                <div className="stage" ref={stageRef}>
                    {/* One area mounted at a time: hidden areas issue no requests */}
                    {activeArea === 'home' ? (
                        <HomeArea
                            roleLabel={permissions.roleLabel}
                            bridge={roster.bridge}
                            rosterStatus={roster.status}
                            canViewPlayers={canViewPlayers}
                            onlinePlayers={onlinePlayers}
                            destinations={destinations}
                            onGoDestination={handleGoDestination}
                            selectedId={selectedPlayer?.citizenid}
                            onSelectPlayer={handleSelectFromHome}
                        />
                    ) : activeArea === 'server' ? (
                        <ServerArea
                            tabs={serverTabs}
                            activeTab={activeServerTab}
                            onTabChange={setServerTab}
                            bansCitizenid={bansCitizenid}
                            onClearBansCitizen={clearBansCitizen}
                        />
                    ) : (
                      <>
                        {canViewPlayers ? (
                            <Billboard
                                player={selectedPlayer}
                                bridgeDown={bridgeDown}
                                writeLog={writeLog}
                                onClear={() => setWriteLog([])}
                            />
                        ) : (
                            <StatusNote
                                className="note--wide"
                                tone="info"
                                title={permissions.roleLabel
                                    ? `Your role (${permissions.roleLabel}) cannot see the citizen list`
                                    : 'You are not allowed to see the citizen list'}
                                detail="Everything on this page starts with a citizen, so there is nothing to show here. An owner can grant players.view under Roles and permissions."
                            />
                        )}

                        {canViewPlayers && selectedPlayer && (
                            /* Gated on view, not edit: locked controls explain themselves */
                            <>
                                <CitizenTabs tabs={tabs} activeId={activeTab} onSelect={setTab} />

                                <div
                                    className="modules"
                                    role="tabpanel"
                                    id={`tabpanel-${activeTab}`}
                                    aria-labelledby={`tab-${activeTab}`}
                                    tabIndex={-1}
                                >
                                    {activeTab === 'identity' && (
                                        <>
                                            <JobManager
                                                key={`job-${selectedPlayer.citizenid}`}
                                                selectedPlayer={selectedPlayer}
                                                jobs={jobs}
                                                jobsError={jobsError}
                                                onApplied={handleApplied}
                                            />
                                            {canSeeCharacterData && (
                                                <PlayerDataManager
                                                    key={`ident-${selectedPlayer.citizenid}`}
                                                    selectedPlayer={selectedPlayer}
                                                    show={['charinfo', 'licences']}
                                                    onApplied={handleApplied}
                                                />
                                            )}
                                            {can('groups.view') && (
                                                <GroupManager
                                                    key={`grp-${selectedPlayer.citizenid}`}
                                                    selectedPlayer={selectedPlayer}
                                                    gangs={gangs}
                                                    gangsError={gangsError}
                                                    onApplied={handleApplied}
                                                />
                                            )}
                                        </>
                                    )}

                                    {activeTab === 'money' && (
                                        <>
                                            <MoneyManager
                                                key={`money-${selectedPlayer.citizenid}`}
                                                selectedPlayer={selectedPlayer}
                                                onApplied={handleApplied}
                                            />
                                            {can('accounts.view') && (
                                                <AccountManager
                                                    key={`acc-${selectedPlayer.citizenid}`}
                                                    selectedPlayer={selectedPlayer}
                                                    onApplied={handleApplied}
                                                    onShowAllAccounts={
                                                        serverAccountsReachable ? showAllAccounts : undefined
                                                    }
                                                />
                                            )}
                                        </>
                                    )}

                                    {activeTab === 'assets' && (
                                        <>
                                            {can('inventory.view') && (
                                                <InventoryManager
                                                    key={`inv-${selectedPlayer.citizenid}`}
                                                    selectedPlayer={selectedPlayer}
                                                    onApplied={handleApplied}
                                                />
                                            )}
                                            {can('vehicles.view') && (
                                                <VehicleManager
                                                    key={`veh-${selectedPlayer.citizenid}`}
                                                    selectedPlayer={selectedPlayer}
                                                    onApplied={handleApplied}
                                                />
                                            )}
                                        </>
                                    )}

                                    {activeTab === 'session' && (
                                        <>
                                            <LiveActionsManager
                                                key={`live-${selectedPlayer.citizenid}`}
                                                selectedPlayer={selectedPlayer}
                                                onApplied={handleApplied}
                                            />
                                            {can('metadata.view') && (
                                                <PlayerDataManager
                                                    key={`cond-${selectedPlayer.citizenid}`}
                                                    selectedPlayer={selectedPlayer}
                                                    show={['condition']}
                                                    onApplied={handleApplied}
                                                />
                                            )}
                                        </>
                                    )}

                                    {activeTab === 'enforcement' && can('bans.view') && (
                                        <BanManager
                                            key={`ban-${selectedPlayer.citizenid}`}
                                            selectedPlayer={selectedPlayer}
                                            onApplied={handleApplied}
                                            onShowServerBans={
                                                serverBansReachable ? showBansForCitizen : undefined
                                            }
                                        />
                                    )}
                                </div>
                            </>
                        )}

                        {canViewPlayers && (
                            <div id="wall">
                                <CitizenWall
                                    players={roster.players}
                                    bridge={roster.bridge}
                                    status={roster.status}
                                    error={roster.error}
                                    isStale={roster.isStale}
                                    search={roster.query.search}
                                    page={page}
                                    onPageChange={setPage}
                                    selectedId={selectedPlayer?.citizenid}
                                    onSelect={handleSelect}
                                />
                            </div>
                        )}
                      </>
                    )}
                </div>
            </div>

            {permissionsOpen && (
                <PermissionsSheet
                    onClose={() => setPermissionsOpen(false)}
                    onSaved={onPermissionsChanged}
                />
            )}
        </CanContext.Provider>
    );
}
