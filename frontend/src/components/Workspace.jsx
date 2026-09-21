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

// What actually stands behind each server section, in one line, for the
// start page. Module level: none of it depends on a render.
const SERVER_HINTS = {
    orgs: 'The jobs and gangs players belong to, and who is in them.',
    accounts: 'Every account on this server, personal and company.',
    bans: 'Everyone kept out, including identifiers with no character.',
    resources: 'The code the game server is running right now.',
    system: 'What this installation is, when something looks wrong.',
};

// Without a configured Discord login the panel runs unprotected. If the
// server sends no text of its own, at least this one stands here.
const OPEN_PANEL_WARNING =
    'Discord login is not configured - this panel is open to anyone who can reach it.';

/**
 * The actual panel. It is mounted only once a session is confirmed (or the
 * protection has demonstrably been switched off) - that way no data request
 * runs into a 401 before it is even clear who is working here.
 *
 * The same applies one level down for permissions: a card that lacks its
 * permission is not mounted at all. If it were, its load call would run
 * into a 403 and the card would report an error - even though nothing is
 * broken. What the user may see but not change stays in place, by contrast:
 * there only the controls are locked.
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
    // Counted up after every mutation and makes the wall reload.
    const [rosterVersion, setRosterVersion] = useState(0);
    const [jobs, setJobs] = useState({});
    const [jobsError, setJobsError] = useState(null);
    const [gangs, setGangs] = useState({});
    const [gangsError, setGangsError] = useState(null);
    // Completed writes of the running session.
    const [writeLog, setWriteLog] = useState([]);
    const [permissionsOpen, setPermissionsOpen] = useState(false);
    // Deliberately not tied to the citizen: someone correcting several
    // balances one after another should stay in "Money".
    const [tab, setTab] = useState('identity');

    // Which of the two main areas is showing, and where the server one
    // stands. Both live here rather than in a router: there are two states
    // in total, no deep links to keep, and a router would be a dependency
    // bought for nothing.
    const [area, setArea] = useState('citizens');
    const [serverTab, setServerTab] = useState('orgs');

    // Which citizen the server-wide ban list is narrowed to, if any. It
    // lives here rather than in the panel because it is set from the other
    // area entirely: the Enforcement tab hands a citizen over and the list
    // opens already filtered. The panel offers the way back out, which is
    // why the clearing handler travels down with it.
    const [bansCitizenid, setBansCitizenid] = useState('');

    // One source for all cards. Hangs off the user object: when the session
    // is reloaded it carries the fresh permission list, and the whole UI
    // follows it - with no re-login.
    const permissions = useMemo(
        () => buildPermissions(user, authDisabled),
        [user, authDisabled],
    );
    const { can } = permissions;

    const canViewPlayers = can('players.view');
    const canEditPermissions = can('permissions.edit');

    const roster = useRoster(search, page, rosterVersion, canViewPlayers);
    const stageRef = useRef(null);

    // Load the job reference data once per session, not on every change.
    // /api/meta/* hangs off the players.view permission - without it we do
    // not even ask.
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

    // The gang reference data, on the same terms as the jobs above: once per
    // session, behind the same players.view gate that /api/meta/* hangs off.
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

    // Selecting brings the header area up: after the click everything that
    // can be changed sits in one field of view.
    const handleSelect = useCallback((player) => {
        setSelectedPlayer(player);
        setWriteLog([]);
        stageRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    }, []);

    // A mutation reported success: update the selected citizen right away,
    // hold on to what happened and pull the wall along.
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

    // "On the server right now" is only a statement when the bridge is
    // answering. Otherwise we do not know it and do not claim it either.
    const onlineNow = Boolean(selectedPlayer?.isOnline && !bridgeDown);

    // Licenses and character data hang off two different permissions; one
    // of them is enough for the card to have anything to show at all.
    const canSeeCharacterData = can('metadata.view') || can('charinfo.edit');

    /* The sections of the module wall. Only what this user may actually see
       is offered - a section that opens up empty explains nothing. */
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

    // Derived instead of synchronized: if the user loses a permission in
    // the middle of the work, the selection falls back to the first section
    // still present, without an effect having to chase after it.
    const activeTab = tabs.some((t) => t.id === tab) ? tab : tabs[0].id;

    /* The sections of the server area. Same rule as above: a section whose
       permission is missing is not mounted at all, because its very first
       request would come back 403 and the section would report a fault
       where there is none.

       Diagnostics hangs off two permissions - the framework probe needs
       resources.view, the rest system.view - and either one on its own is
       enough for the section to have something to show. */
    const serverTabs = useMemo(() => {
        const list = [];

        if (can('orgs.view')) list.push({ id: 'orgs', label: 'Organisations', icon: 'briefcase' });
        if (can('accounts.view')) list.push({ id: 'accounts', label: 'Accounts', icon: 'bank' });
        if (can('bans.view')) list.push({ id: 'bans', label: 'Bans', icon: 'ban' });
        if (can('resources.view')) list.push({ id: 'resources', label: 'Resources', icon: 'box' });
        if (can('system.view') || can('resources.view')) {
            list.push({ id: 'system', label: 'Diagnostics', icon: 'pulse' });
        }

        return list;
    }, [can]);

    // No server permission at all, no second area - and then no switch
    // either. An area that opens onto nothing explains nothing.
    const areas = useMemo(() => {
        const list = [{ id: 'citizens', label: 'Citizens', icon: 'users' }];
        if (serverTabs.length > 0) list.push({ id: 'server', label: 'Server', icon: 'server' });
        return list;
    }, [serverTabs]);

    // Derived, like the tab above: if the last server permission is taken
    // away mid-session, the area falls back to the citizens without an
    // effect having to chase after it.
    const activeArea = area === 'home' || areas.some((a) => a.id === area)
        ? area
        : 'citizens';
    const activeServerTab = serverTabs.some((t) => t.id === serverTab)
        ? serverTab
        : serverTabs[0]?.id;

    // Switching area starts at the top: the two areas are different heights
    // and keeping the scroll offset would land mid-card in the other one.
    const handleAreaChange = useCallback((next) => {
        setArea(next);
        stageRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    }, []);

    // Choosing a citizen from the start page means switching area and
    // opening them there. Without the switch the selection would stay out
    // of sight.
    const handleSelectFromHome = useCallback((player) => {
        handleSelect(player);
        setArea('citizens');
    }, [handleSelect]);

    // The citizen's account card used to open the server-wide list in an
    // overlay of its own. The list now lives in the server area, so the
    // card sends the user there instead of holding a second copy.
    const showAllAccounts = useCallback(() => {
        setServerTab('accounts');
        handleAreaChange('server');
    }, [handleAreaChange]);

    const serverAccountsReachable = serverTabs.some((t) => t.id === 'accounts');

    // The same move as the accounts one above, for the ban record. The
    // citizen card can only ever show the bans that match the character in
    // front of it, out of the database table alone; the server-wide list
    // holds both records and the entries hanging off identifiers with no
    // character behind them. So the Enforcement tab sends the user there
    // with this citizen already filtered, instead of growing a second copy
    // of that list inside the card.
    const showBansForCitizen = useCallback(() => {
        const citizenid = selectedPlayer?.citizenid;
        if (!citizenid) return;
        setBansCitizenid(citizenid);
        setServerTab('bans');
        handleAreaChange('server');
    }, [selectedPlayer, handleAreaChange]);

    const clearBansCitizen = useCallback(() => setBansCitizenid(''), []);

    const serverBansReachable = serverTabs.some((t) => t.id === 'bans');

    /* The destinations on the start page. Only what this user may actually
       enter is offered - a row pointing at a locked door would be worse
       than no row.

       Plain data, no callbacks: a closure built here would capture the
       scroll ref and be created fresh on every render, which is both a
       React warning and a pointless allocation. Where a row leads is a
       fact; acting on it belongs to the handler below. */
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

    // Whoever is connected right now, as far as the loaded page carries
    // them. The start page says so itself when the bridge counts more than
    // what stands here.
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

                {/* Both bars stand outside the scrolling area and share one
                    row of the grid - otherwise the stage below would get no
                    height of its own once two messages are up. */}
                {warned && (
                    <div className="banners">
                        {/* Running unprotected is no detail: in this state
                            anyone who can reach the port can create money.
                            The warning cannot be clicked away. */}
                        {authDisabled && (
                            <StatusNote
                                className="banner"
                                tone="warn"
                                title="Anyone who can reach this panel can use it"
                                detail={warning || OPEN_PANEL_WARNING}
                            />
                        )}

                        {/* A permission was withdrawn mid-work. Once here,
                            instead of in every card separately - the cards
                            saw nothing of it but a 403, which on its own
                            explains nothing. */}
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
                    {/* The two main areas. The citizen one is everything the
                        panel was; the server one holds what belongs to no
                        citizen. Only one is mounted at a time, so the other
                        one's cards issue no requests while out of sight. */}
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
                            /* Without players.view there is no way in: everything
                               on this page starts with a citizen. Saying that
                               once is more honest than an empty wall. */
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
                            /* The module wall now stands in sections. Before,
                               up to thirteen cards lay stacked at once and you
                               scrolled past all of them to change one.

                               A new module goes into the section it belongs to
                               by subject, and shows up there by itself.
                               key still makes sure the forms restart when the
                               citizen changes.

                               The condition in front of each card is its view
                               permission, not its edit permission: locked
                               controls explain themselves, a missing card does not. */
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
                                                    /* The server-wide list used to
                                                       open from here as an overlay.
                                                       It lives in the server area
                                                       now, so the card points there
                                                       instead of holding a copy. */
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
                                            /* Left out where the server
                                               area cannot be entered: a
                                               door onto nothing explains
                                               less than no door. */
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
