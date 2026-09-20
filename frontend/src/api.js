// src/api.js
import axios from 'axios';

// Relativ: im Dev übernimmt der Vite-Proxy (siehe vite.config.js),
// im Build liegt das Frontend hinter derselben Origin wie die API.
// withCredentials ist Pflicht: ohne das schickt der Browser das
// Sitzungscookie nicht mit und jede Anfrage liefe in den 401.
const api = axios.create({
    baseURL: '/api',
    withCredentials: true,
});

// --- Anmeldung ------------------------------------------------------------

// Fallback, falls der Server keine loginUrl mitschickt.
export const DEFAULT_LOGIN_URL = '/api/auth/login';

// Antwortet immer mit 200; "nicht angemeldet" ist dort kein Fehlerfall.
export const fetchSession = () => api.get('/auth/me');
export const signOutRequest = () => api.post('/auth/logout');

// Die loginUrl kommt aus einer Antwort, landet aber in window.location -
// deshalb nur ein Pfad auf der eigenen Origin, kein "//fremder.host".
export const safeLoginUrl = (value) => {
    if (typeof value !== 'string') return DEFAULT_LOGIN_URL;
    const url = value.trim();
    if (!url.startsWith('/') || url.startsWith('//')) return DEFAULT_LOGIN_URL;
    return url;
};

// Anmelden ist eine echte Seitennavigation, kein XHR: Discord braucht den
// Browser, ein fetch() wuerde am OAuth-Dialog scheitern.
export const startDiscordLogin = (loginUrl) => {
    window.location.href = safeLoginUrl(loginUrl);
};

// --- Globale 401-Behandlung -----------------------------------------------
// Laeuft die Sitzung mitten in der Arbeit ab, soll nicht jede Karte einzeln
// "could not be loaded" melden. Stattdessen meldet der Interceptor einmal
// nach oben, und die App faellt geschlossen auf den Anmeldebildschirm.

const unauthorizedHandlers = new Set();

export function onUnauthorized(handler) {
    unauthorizedHandlers.add(handler);
    return () => { unauthorizedHandlers.delete(handler); };
}

// /auth/* ist ausgenommen: /auth/me beantwortet die Frage nach der Sitzung
// gerade erst, und ein 401 beim Abmelden heisst nur "war schon abgemeldet".
const isAuthRoute = (url) => {
    if (typeof url !== 'string') return false;
    const path = url.split('?')[0];
    return path.startsWith('/auth/') || path.startsWith('auth/') || path.startsWith('/api/auth/');
};

api.interceptors.response.use(
    (response) => response,
    (error) => {
        if (error?.response?.status === 401 && !isAuthRoute(error.config?.url)) {
            unauthorizedHandlers.forEach((handler) => handler());
        }
        return Promise.reject(error);
    },
);

// Citizen-IDs und Datensatz-IDs stehen im Pfad und koennen Zeichen enthalten,
// die dort eine eigene Bedeutung haetten - deshalb durchgaengig kodiert.
const seg = (value) => encodeURIComponent(String(value));

// Helper Funktionen
export const fetchPlayers = (params) => api.get('/players', { params });
export const fetchJobs = () => api.get('/meta/jobs');
export const updatePlayerJob = (citizenid, jobData) => api.post('/manage/job', { citizenid, ...jobData });
export const updatePlayerMoney = (citizenid, amount, type) => api.post('/manage/money', { citizenid, amount, type });

// --- Fahrzeuge ------------------------------------------------------------
export const fetchPlayerVehicles = (citizenid) => api.get(`/players/${seg(citizenid)}/vehicles`);
export const createVehicle = (citizenid, vehicle) => api.post('/manage/vehicle', { citizenid, ...vehicle });
export const updateVehicle = (id, changes) => api.patch(`/manage/vehicle/${seg(id)}`, changes);
export const deleteVehicle = (id) => api.delete(`/manage/vehicle/${seg(id)}`);

// --- Inventar -------------------------------------------------------------
export const fetchPlayerInventory = (citizenid) => api.get(`/players/${seg(citizenid)}/inventory`);
export const updatePlayerInventory = (citizenid, change) => api.post('/manage/inventory', { citizenid, ...change });

// --- Lizenzen, Status, Charakterdaten -------------------------------------
export const fetchPlayerMetadata = (citizenid) => api.get(`/players/${seg(citizenid)}/metadata`);
export const updatePlayerLicense = (citizenid, license, value) => api.post('/manage/license', { citizenid, license, value });
export const updatePlayerStatus = (citizenid, changes) => api.post('/manage/status', { citizenid, changes });
export const updatePlayerCharinfo = (citizenid, charinfo) => api.post('/manage/charinfo', { citizenid, ...charinfo });

// --- Stammdaten fuer die Auswahllisten ------------------------------------
// Beide Kataloge sind zu gross, um sie im Ganzen zu laden: gesucht wird
// serverseitig, die Oberflaeche zeigt nur den angefragten Ausschnitt.
export const fetchMetaItems = (params) => api.get('/meta/items', { params });
export const fetchMetaVehicles = (params) => api.get('/meta/vehicles', { params });
export const fetchMetaSummary = () => api.get('/meta/summary');

export default api;
