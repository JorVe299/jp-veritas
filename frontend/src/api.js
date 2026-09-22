// src/api.js
import axios from 'axios';

// Relative: in development the Vite proxy takes over (see vite.config.js),
// in the build the frontend sits behind the same origin as the API.
// withCredentials is mandatory: without it the browser does not send the
// session cookie and every request would run into a 401.
const api = axios.create({
    baseURL: '/api',
    withCredentials: true,
});

// --- Sign-in --------------------------------------------------------------

// Fallback in case the server does not send a loginUrl.
export const DEFAULT_LOGIN_URL = '/api/auth/login';

// Always answers with 200; "not signed in" is not an error case there.
export const fetchSession = () => api.get('/auth/me');
export const signOutRequest = () => api.post('/auth/logout');

// The loginUrl comes out of a response but ends up in window.location -
// so only a path on our own origin, never a "//foreign.host".
export const safeLoginUrl = (value) => {
    if (typeof value !== 'string') return DEFAULT_LOGIN_URL;
    const url = value.trim();
    if (!url.startsWith('/') || url.startsWith('//')) return DEFAULT_LOGIN_URL;
    return url;
};

// Signing in is a real page navigation, not an XHR: Discord needs the
// browser, a fetch() would fail at the OAuth dialog.
export const startDiscordLogin = (loginUrl, surface) => {
    const url = safeLoginUrl(loginUrl);
    // A flag, not a path. The backend maps it through a fixed table of two
    // entries, so this cannot steer the return trip anywhere else.
    const target = surface === 'portal'
        ? `${url}${url.includes('?') ? '&' : '?'}surface=portal`
        : url;
    window.location.href = target;
};

// --- Global 401 handling --------------------------------------------------
// If the session expires in the middle of the work, not every card should
// report "could not be loaded" on its own. Instead the interceptor reports
// once upwards, and the app falls back to the sign-in screen as a whole.

const unauthorizedHandlers = new Set();

export function onUnauthorized(handler) {
    unauthorizedHandlers.add(handler);
    return () => { unauthorizedHandlers.delete(handler); };
}

// /auth/* is exempt: /auth/me is only just answering the question about the
// session, and a 401 on sign-out only means "was already signed out".
const isAuthRoute = (url) => {
    if (typeof url !== 'string') return false;
    const path = url.split('?')[0];
    return path.startsWith('/auth/') || path.startsWith('auth/') || path.startsWith('/api/auth/');
};

// --- Global 403 handling --------------------------------------------------
// The counterpart: it is not the session that is gone but a permission. That
// can happen mid-work because an owner changes the matrix - and without any
// re-login at that. If every card reported it separately, eight "could not
// be loaded" messages would stand on screen at once, all of them meaning
// the same thing. So: once, centrally, and the session is read again so
// that the UI corrects itself.

const forbiddenHandlers = new Set();

export function onForbidden(handler) {
    forbiddenHandlers.add(handler);
    return () => { forbiddenHandlers.delete(handler); };
}

// Veritas ID's own routes are exempt: a 403 from /api/me means "this
// account may not use Veritas ID at all", which is a standing fact about
// the account rather than a permission pulled out from under work in
// progress. The portal says so in place, on its own front door, and the
// panel's banner has nothing to do with it.
const isPortalRoute = (url) => {
    if (typeof url !== 'string') return false;
    const path = url.split('?')[0].replace(/^\/api/, '');
    return path === '/me' || path.startsWith('/me/');
};

// Writes under /permissions are exempt: there a 403 is the expected answer
// for anyone who is not the owner. That is information, not a permission
// being taken away - the message belongs on the surface, not on the bar
// above it all. The role routes below the path count too: creating,
// renaming, reordering and deleting a role are the same answer to the same
// question.
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
            unauthorizedHandlers.forEach((handler) => handler());
        }

        if (status === 403 && !isAuthRoute(url) && !isPortalRoute(url) && !isPermissionWrite(error.config)) {
            const body = error.response?.data || {};
            forbiddenHandlers.forEach((handler) => handler(body));
        }

        return Promise.reject(error);
    },
);

// Citizen IDs and record IDs sit in the path and can contain characters that
// would carry their own meaning there - hence encoded throughout.
const seg = (value) => encodeURIComponent(String(value));

// Helper functions
export const fetchPlayers = (params) => api.get('/players', { params });
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

// --- Bans -----------------------------------------------------------------
// A ban hangs off license and Discord ID, not off the citizenid: what gets
// blocked is the access, not the single character.
export const fetchPlayerBans = (citizenid) => api.get(`/players/${seg(citizenid)}/bans`);
// Both ban records in one list: the `bans` table this panel writes and
// txAdmin's own file beside the server, merged and sorted by the route.
// It replaces the two separate list calls that used to stand here - the
// question "who is kept out" was never one that cared which file holds
// the answer.
//
// Parameters, all optional: q, citizenid, active, include, source, page,
// limit. Every row keeps its source, because only the database rows can be
// lifted, and liftBan below is the only write either record accepts.
export const fetchAllBans = (params) => api.get('/bans/all', { params });
// Omitting days, or 0, means permanent - hence no default value here.
export const banPlayer = (citizenid, ban) => api.post('/manage/ban', { citizenid, ...ban });
export const liftBan = (id) => api.delete(`/manage/ban/${seg(id)}`);

// --- Groups ---------------------------------------------------------------
// Multiple memberships from player_groups, not the active job from players.
export const fetchPlayerGroups = (citizenid) => api.get(`/players/${seg(citizenid)}/groups`);
export const fetchGangs = () => api.get('/meta/gangs');
export const setPlayerGroup = (citizenid, group) => api.post('/manage/group', { citizenid, ...group });
// The route expects the body on DELETE as well; axios needs data for that.
// The type travels with it so the caller states which half of player_groups
// it is removing, the same way the write does.
export const removePlayerGroup = (citizenid, group, type) => api.delete('/manage/group', {
    data: type ? { citizenid, group, type } : { citizenid, group },
});

// --- Bank accounts --------------------------------------------------------
export const fetchPlayerAccounts = (citizenid) => api.get(`/players/${seg(citizenid)}/accounts`);
export const fetchAccounts = (params) => api.get('/accounts', { params });
export const updateAccount = (id, amount, mode) => api.post('/manage/account', { id, amount, mode });
export const setAccountFrozen = (id, frozen) => api.post('/manage/account/freeze', { id, frozen });

// --- Live actions ---------------------------------------------------------
// The five actions require an existing connection and otherwise answer with
// 409. Position is the exception: it is readable offline too and then says
// where the character logged out.
export const kickPlayer = (citizenid, reason) => api.post('/manage/kick', { citizenid, reason });
export const revivePlayer = (citizenid) => api.post('/manage/revive', { citizenid });
export const healPlayer = (citizenid, armor = true) => api.post('/manage/heal', { citizenid, armor });
export const teleportPlayer = (citizenid, position) => api.post('/manage/teleport', { citizenid, ...position });
export const notifyPlayer = (citizenid, message, type) => api.post('/manage/notify', { citizenid, message, type });
export const fetchPlayerPosition = (citizenid) => api.get(`/players/${seg(citizenid)}/position`);

// --- Roles and permissions ------------------------------------------------
// Anyone signed in may read - the frontend needs the list in order to
// explain why a button is locked. Only the owner may write; everyone
// else gets a 403 there, and that is then the answer to the
// question, not an error.
export const fetchPermissions = () => api.get('/permissions');
export const savePermissions = (matrix) => api.put('/permissions', { matrix });

// The roles themselves. Four names compiled into the source were enough for
// one server and for no other: a installation with a support lead, a vehicle
// crew and a whitelist team needs its own, and creating one must not mean a
// redeploy. Every one of these is owner-only and answers 403 otherwise.
//
// `body` is { label, id?, capabilities?, copyFrom?, discordUserIds?,
// discordRoleIds? } - everything but the label optional.
export const createRole = (body) => api.post('/permissions/roles', body);

// Any of { label, capabilities, discordUserIds, discordRoleIds }. What is
// not sent stays as it is; the owner keeps its capabilities whatever the
// patch says.
export const updateRole = (id, patch) => api.patch(`/permissions/roles/${seg(id)}`, patch);

export const deleteRole = (id) => api.delete(`/permissions/roles/${seg(id)}`);

// The order is the ranking, not the layout: whoever matches two roles in
// Discord gets the one nearer the top.
export const saveRoleOrder = (order) => api.put('/permissions/roles/order', { order });

// --- Organisations --------------------------------------------------------
// Jobs and gangs seen as bodies in their own right, not as a field on a
// character. A police force has a balance, a headcount and a rank structure
// whether or not anybody is looking at a single officer.
export const fetchOrganisations = (params) => api.get('/jobs', { params });
export const fetchOrganisationMembers = (name, params) =>
    api.get(`/jobs/${seg(name)}/members`, { params });

// --- Resources on the game server -----------------------------------------
// --- Diagnostics ----------------------------------------------------------
// The framework probe answers 502 when the bridge is silent - that is an
// answer, not a failure, and the panel says so.
export const fetchFramework = () => api.get('/system/framework');
export const fetchSchema = () => api.get('/system/schema');
export const fetchBridgeReport = () => api.get('/system/bridge');
export const refreshGameData = () => api.post('/system/refresh');

// --- Veritas ID -----------------------------------------------------------
// The player-facing surface. Everything under /api/me is read-only and is
// scoped to the signed-in Discord account by the server - there is no
// citizenid here that the account does not own. A 404 is deliberately the
// same answer for "no such character" and "not one of yours", so nothing in
// the frontend may word it as either.
export const fetchMyAccount = () => api.get('/me');
// Account level, not character level: a txAdmin ban is issued against
// identifiers and therefore follows the person across every character they
// have. Answers 200 even when the record cannot be read at all - the body
// then says available: false, which is a different fact from an empty list
// and must never be folded into one.
export const fetchMyBans = () => api.get('/me/bans');
export const fetchMyCharacter = (citizenid) => api.get(`/me/characters/${seg(citizenid)}`);
export const fetchMyInventory = (citizenid) => api.get(`/me/characters/${seg(citizenid)}/inventory`);
export const fetchMyVehicles = (citizenid) => api.get(`/me/characters/${seg(citizenid)}/vehicles`);

// --- Reference data for the pickers ---------------------------------------
// Both catalogs are too large to load whole: the search runs on the
// server, the surface only shows the requested slice.
export const fetchMetaItems = (params) => api.get('/meta/items', { params });
export const fetchMetaVehicles = (params) => api.get('/meta/vehicles', { params });
export const fetchMetaSummary = () => api.get('/meta/summary');

export default api;
