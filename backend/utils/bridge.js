// backend/utils/bridge.js
// Everything to do with the live connection to the FiveM server.
const axios = require('axios');

const FIVEM_API_URL = process.env.FIVEM_API_URL || 'http://127.0.0.1:30120/veritas';
const BRIDGE_TIMEOUT = parseInt(process.env.BRIDGE_TIMEOUT) || 2500;

// Shared secret with the bridge resource. Sent on every call; the bridge
// only insists on it for the routes that can run arbitrary exports, but
// sending it always means turning on RequireTokenEverywhere over there
// needs no change here.
const BRIDGE_TOKEN = process.env.BRIDGE_TOKEN || '';

function headers() {
    return BRIDGE_TOKEN ? { 'X-Veritas-Token': BRIDGE_TOKEN } : {};
}

// Asks the bridge whether a player is currently online.
// If the server cannot be reached we treat them as offline and fall back
// to the SQL path automatically.
async function isPlayerOnline(citizenid) {
    try {
        const res = await axios.post(`${FIVEM_API_URL}/check-online`, { citizenid }, { timeout: BRIDGE_TIMEOUT, headers: headers() });
        return !!res.data.isOnline;
    } catch (e) {
        console.warn(`[Bridge] check-online failed (${e.code || e.message}) - falling back to SQL`);
        return false;
    }
}

// Fetches the list of online citizen ids.
// Always reports WHETHER the bridge answered as well - otherwise the
// frontend cannot tell "player is offline" from "we do not know".
async function fetchOnlinePlayers() {
    try {
        const res = await axios.get(`${FIVEM_API_URL}/get-online-players`, { timeout: BRIDGE_TIMEOUT, headers: headers() });
        const data = res.data;

        // Lua encodes an empty table as [] rather than {} - that is not an
        // error, it simply means nobody is online
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

// Generic POST to a bridge route.
// Throws with a meaningful message when the resource reports
// "success: false", so the routes do not each have to check for it.
async function callBridge(route, payload) {
    const res = await axios.post(`${FIVEM_API_URL}${route}`, payload, { timeout: BRIDGE_TIMEOUT, headers: headers() });
    if (res.data && res.data.success === false) {
        const err = new Error(res.data.msg || 'The bridge rejected the action');
        err.bridgeRejected = true;
        throw err;
    }
    return res.data;
}

// What the game server says about itself: which framework, which inventory,
// whether a token is configured. Read once at startup and on demand, so the
// panel can state the setup instead of assuming it.
async function fetchStatus() {
    try {
        const res = await axios.get(`${FIVEM_API_URL}/status`, { timeout: BRIDGE_TIMEOUT, headers: headers() });
        return { reachable: true, ...res.data };
    } catch (e) {
        return { reachable: false, error: e.code || e.message };
    }
}

// Generic GET against a bridge route - used by the resource browser.
async function getBridge(route) {
    const res = await axios.get(`${FIVEM_API_URL}${route}`, { timeout: BRIDGE_TIMEOUT, headers: headers() });
    return res.data;
}

module.exports = {
    FIVEM_API_URL, BRIDGE_TIMEOUT, HAS_TOKEN: BRIDGE_TOKEN !== '',
    isPlayerOnline, fetchOnlinePlayers, callBridge, fetchStatus, getBridge
};
