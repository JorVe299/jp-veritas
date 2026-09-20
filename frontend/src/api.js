// src/api.js
import axios from 'axios';

// Relativ: im Dev übernimmt der Vite-Proxy (siehe vite.config.js),
// im Build liegt das Frontend hinter derselben Origin wie die API.
const api = axios.create({
    baseURL: '/api',
});

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
