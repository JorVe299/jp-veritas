import axios from 'axios';

// Relative: Vite proxy in dev (vite.config.js), same origin in the build
// withCredentials: without it no session cookie is sent and every request 401s
const api = axios.create({
    baseURL: '/api',
    withCredentials: true,
});

// --- Sign-in --------------------------------------------------------------

export const DEFAULT_LOGIN_URL = '/api/auth/login';

// Always 200, signed out included; `ended` holds the reason when the server ended the session
export const fetchSession = () => api.get('/auth/me');
export const signOutRequest = () => api.post('/auth/logout');

// Server-supplied but assigned to window.location: same-origin paths only, never "//host"
export const safeLoginUrl = (value) => {
    if (typeof value !== 'string') return DEFAULT_LOGIN_URL;
    const url = value.trim();
    if (!url.startsWith('/') || url.startsWith('//')) return DEFAULT_LOGIN_URL;
    return url;
};

// Full page navigation, not XHR: a fetch() would fail at Discord's OAuth dialog
export const startDiscordLogin = (loginUrl, surface) => {
    const url = safeLoginUrl(loginUrl);
    // A flag, not a path: the backend maps it through a fixed two-entry table
    const target = surface === 'portal'
        ? `${url}${url.includes('?') ? '&' : '?'}surface=portal`
        : url;
    window.location.href = target;
};

// --- Global 401 handling --------------------------------------------------
// Reported once, centrally: the app drops to sign-in instead of every card failing

const unauthorizedHandlers = new Set();

export function onUnauthorized(handler) {
    unauthorizedHandlers.add(handler);
    return () => { unauthorizedHandlers.delete(handler); };
}

// Exempt: /auth/me is the session check itself; a 401 on logout means already signed out
const isAuthRoute = (url) => {
    if (typeof url !== 'string') return false;
    const path = url.split('?')[0];
    return path.startsWith('/auth/') || path.startsWith('auth/') || path.startsWith('/api/auth/');
};

// --- Global 403 handling --------------------------------------------------
// Permission revoked mid-work by a matrix edit: reported once, not by every card

const forbiddenHandlers = new Set();

export function onForbidden(handler) {
    forbiddenHandlers.add(handler);
    return () => { forbiddenHandlers.delete(handler); };
}

// Exempt: a 403 from /api/me is a standing "no Veritas ID", shown by the portal itself
const isPortalRoute = (url) => {
    if (typeof url !== 'string') return false;
    const path = url.split('?')[0].replace(/^\/api/, '');
    return path === '/me' || path.startsWith('/me/');
};

// Exempt, role routes included: a 403 here is the expected non-owner answer, shown in place
const WRITE_METHODS = ['put', 'post', 'patch', 'delete'];

const isPermissionWrite = (config) => {
    const method = String(config?.method || '').toLowerCase();
    if (!WRITE_METHODS.includes(method)) return false;
    const raw = String(config?.url || '').split('?')[0].replace(/^\/api/, '');
    const path = raw.startsWith('/') ? raw : `/${raw}`;
    return path === '/permissions' || path.startsWith('/permissions/');
};

api.interceptors.response.use(
    (response) => response,
    (error) => {
        const status = error?.response?.status;
        const url = error.config?.url;

        if (status === 401 && !isAuthRoute(url)) {
            // Body passed on: its `error` replaces a generic "expired" on the sign-in screen
            const body = error.response?.data || {};
            unauthorizedHandlers.forEach((handler) => handler(body));
        }

        if (status === 403 && !isAuthRoute(url) && !isPortalRoute(url) && !isPermissionWrite(error.config)) {
            const body = error.response?.data || {};
            forbiddenHandlers.forEach((handler) => handler(body));
        }

        return Promise.reject(error);
    },
);

// Every ID in a path goes through this: IDs may contain reserved characters
const seg = (value) => encodeURIComponent(String(value));

// --- Jobs and money -------------------------------------------------------
export const fetchJobs = () => api.get('/meta/jobs');
export const updatePlayerJob = (citizenid, jobData) => api.post('/manage/job', { citizenid, ...jobData });
export const updatePlayerMoney = (citizenid, amount, type) => api.post('/manage/money', { citizenid, amount, type });

// --- Vehicles -------------------------------------------------------------
export const fetchPlayerVehicles = (citizenid) => api.get(`/players/${seg(citizenid)}/vehicles`);
export const createVehicle = (citizenid, vehicle) => api.post('/manage/vehicle', { citizenid, ...vehicle });
export const updateVehicle = (id, changes) => api.patch(`/manage/vehicle/${seg(id)}`, changes);
export const deleteVehicle = (id) => api.delete(`/manage/vehicle/${seg(id)}`);

// --- Inventory ------------------------------------------------------------
export const fetchPlayerInventory = (citizenid) => api.get(`/players/${seg(citizenid)}/inventory`);
export const updatePlayerInventory = (citizenid, change) => api.post('/manage/inventory', { citizenid, ...change });

// --- Licenses, status, character data -------------------------------------
export const fetchPlayerMetadata = (citizenid) => api.get(`/players/${seg(citizenid)}/metadata`);
export const updatePlayerLicense = (citizenid, license, value) => api.post('/manage/license', { citizenid, license, value });
export const updatePlayerStatus = (citizenid, changes) => api.post('/manage/status', { citizenid, changes });
export const updatePlayerCharinfo = (citizenid, charinfo) => api.post('/manage/charinfo', { citizenid, ...charinfo });
// Irreversible; 409 while connected; 503/504: nothing deleted, or not confirmed
export const deleteCharacter = (citizenid) => api.delete(`/manage/character/${seg(citizenid)}`);

// --- Bans -----------------------------------------------------------------
// Bans follow license and Discord ID, not the citizenid: access is blocked, not a character
export const fetchPlayerBans = (citizenid) => api.get(`/players/${seg(citizenid)}/bans`);
// Panel `bans` table and txAdmin's file, merged and sorted by the route
// Optional params: q, citizenid, active, include, source, page, limit
// Rows keep their source: only database rows can be lifted (liftBan)
export const fetchAllBans = (params) => api.get('/bans/all', { params });
// No days default: omitted or 0 means permanent
export const banPlayer = (citizenid, ban) => api.post('/manage/ban', { citizenid, ...ban });
export const liftBan = (id) => api.delete(`/manage/ban/${seg(id)}`);
export const fetchBanHistory = (citizenid) => api.get(`/players/${seg(citizenid)}/ban-history`);
export const deleteBanHistory = (id) => api.delete(`/manage/ban-history/${seg(id)}`);

// --- Groups ---------------------------------------------------------------
// All memberships (player_groups), not the active job
export const fetchPlayerGroups = (citizenid) => api.get(`/players/${seg(citizenid)}/groups`);
export const fetchGangs = () => api.get('/meta/gangs');
export const setPlayerGroup = (citizenid, group) => api.post('/manage/group', { citizenid, ...group });
// DELETE with a body: axios needs `data` for it
// type required: a name is unique only within a type ('vagos' can be a job and a gang)
export const removePlayerGroup = (citizenid, group, type) => api.delete('/manage/group', {
    data: { citizenid, group, type },
});

// --- Bank accounts --------------------------------------------------------
export const fetchPlayerAccounts = (citizenid) => api.get(`/players/${seg(citizenid)}/accounts`);
export const fetchAccounts = (params) => api.get('/accounts', { params });
export const updateAccount = (id, amount, mode) => api.post('/manage/account', { id, amount, mode });
export const setAccountFrozen = (id, frozen) => api.post('/manage/account/freeze', { id, frozen });

// --- Live actions ---------------------------------------------------------
// Actions need the player online, else 409; position also reads offline (logout spot)
export const kickPlayer = (citizenid, reason) => api.post('/manage/kick', { citizenid, reason });
export const revivePlayer = (citizenid) => api.post('/manage/revive', { citizenid });
export const healPlayer = (citizenid, armor = true) => api.post('/manage/heal', { citizenid, armor });
export const teleportPlayer = (citizenid, position) => api.post('/manage/teleport', { citizenid, ...position });
export const notifyPlayer = (citizenid, message, type) => api.post('/manage/notify', { citizenid, message, type });
export const fetchPlayerPosition = (citizenid) => api.get(`/players/${seg(citizenid)}/position`);

// --- Roles and permissions ------------------------------------------------
// Any signed-in user may read (to explain locked buttons); writes are owner-only, else 403
export const fetchPermissions = () => api.get('/permissions');
export const savePermissions = (matrix) => api.put('/permissions', { matrix });

// body: { label, id?, capabilities?, copyFrom?, discordUserIds?, discordRoleIds? }
export const createRole = (body) => api.post('/permissions/roles', body);

// patch: any of { label, capabilities, discordUserIds, discordRoleIds }; omitted = unchanged
// The owner role keeps its capabilities whatever the patch says
export const updateRole = (id, patch) => api.patch(`/permissions/roles/${seg(id)}`, patch);

export const deleteRole = (id) => api.delete(`/permissions/roles/${seg(id)}`);

// Order is rank, not layout: matching two roles in Discord yields the higher one
export const saveRoleOrder = (order) => api.put('/permissions/roles/order', { order });

// --- Organisations --------------------------------------------------------
export const fetchOrganisations = (params) => api.get('/jobs', { params });
export const fetchOrganisationMembers = (name, params) =>
    api.get(`/jobs/${seg(name)}/members`, { params });

// --- Diagnostics ----------------------------------------------------------
// Framework probe: 502 means a silent bridge, an answer rather than a failure
export const fetchFramework = () => api.get('/system/framework');
export const fetchSchema = () => api.get('/system/schema');
export const fetchBridgeReport = () => api.get('/system/bridge');
export const refreshGameData = () => api.post('/system/refresh');

// --- Veritas ID -----------------------------------------------------------
// Read-only, scoped server-side to the signed-in account
// 404 means "no such character" or "not yours" alike: never word it as either
export const fetchMyAccount = () => api.get('/me');
// Account level: txAdmin bans follow identifiers across characters
// Always 200; `available: false` means unreadable, never the same as an empty list
export const fetchMyBans = () => api.get('/me/bans');
export const fetchMyCharacter = (citizenid) => api.get(`/me/characters/${seg(citizenid)}`);
export const fetchMyInventory = (citizenid) => api.get(`/me/characters/${seg(citizenid)}/inventory`);
export const fetchMyVehicles = (citizenid) => api.get(`/me/characters/${seg(citizenid)}/vehicles`);

// --- Reference data for the pickers ---------------------------------------
// Too large to load whole: searched server-side, fetched a slice at a time
export const fetchMetaItems = (params) => api.get('/meta/items', { params });
export const fetchMetaVehicles = (params) => api.get('/meta/vehicles', { params });

export default api;
