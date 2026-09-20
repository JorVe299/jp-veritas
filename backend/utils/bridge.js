// backend/utils/bridge.js
// Alles, was mit der Live-Verbindung zum FiveM Server zu tun hat.
const axios = require('axios');

const FIVEM_API_URL = process.env.FIVEM_API_URL || 'http://127.0.0.1:30120/jp-veritas';
const BRIDGE_TIMEOUT = parseInt(process.env.BRIDGE_TIMEOUT) || 2500;

// Fragt die Bridge, ob ein Spieler gerade online ist.
// Wenn der Server nicht erreichbar ist, behandeln wir ihn als offline
// und gehen automatisch den SQL-Weg.
async function isPlayerOnline(citizenid) {
    try {
        const res = await axios.post(`${FIVEM_API_URL}/check-online`, { citizenid }, { timeout: BRIDGE_TIMEOUT });
        return !!res.data.isOnline;
    } catch (e) {
        console.warn(`[Bridge] check-online failed (${e.code || e.message}) - falling back to SQL`);
        return false;
    }
}

// Holt die Liste der online CitizenIDs.
// Gibt immer auch zurück, OB die Bridge antwortet - sonst ist im Frontend
// "Spieler ist offline" nicht von "wir wissen es nicht" zu unterscheiden.
async function fetchOnlinePlayers() {
    try {
        const res = await axios.get(`${FIVEM_API_URL}/get-online-players`, { timeout: BRIDGE_TIMEOUT });
        const data = res.data;

        // Lua kodiert eine leere Table als [] statt {} - das ist kein Fehler,
        // sondern schlicht "niemand online"
        if (Array.isArray(data) || data === null || typeof data !== 'object') {
            return { online: {}, reachable: true };
        }
        return { online: data, reachable: true };
    } catch (e) {
        const reason = e.code || e.message;
        console.warn(`[Bridge] ${FIVEM_API_URL}/get-online-players unreachable: ${reason}`);
        return { online: {}, reachable: false, error: reason };
    }
}

// Generischer POST an eine Bridge-Route.
// Wirft mit einer sprechenden Meldung, wenn die Resource "success: false" meldet,
// damit die Routen das nicht jedes Mal selbst auswerten müssen.
async function callBridge(route, payload) {
    const res = await axios.post(`${FIVEM_API_URL}${route}`, payload, { timeout: BRIDGE_TIMEOUT });
    if (res.data && res.data.success === false) {
        const err = new Error(res.data.msg || 'The bridge rejected the action');
        err.bridgeRejected = true;
        throw err;
    }
    return res.data;
}

module.exports = { FIVEM_API_URL, BRIDGE_TIMEOUT, isPlayerOnline, fetchOnlinePlayers, callBridge };
