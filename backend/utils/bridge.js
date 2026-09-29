// HTTP client for the FiveM bridge resource (veritas/)
const axios = require('axios');

const FIVEM_API_URL = process.env.FIVEM_API_URL || 'http://127.0.0.1:30120/veritas';
const BRIDGE_TIMEOUT = parseInt(process.env.BRIDGE_TIMEOUT) || 2500;

// Always sent; the bridge checks it only with Config.RequireTokenEverywhere (BACKEND.md §5)
const BRIDGE_TOKEN = process.env.BRIDGE_TOKEN || '';

function headers() {
    return BRIDGE_TOKEN ? { 'X-Veritas-Token': BRIDGE_TOKEN } : {};
}

// Unreachable bridge = offline: callers fall back to SQL
async function isPlayerOnline(citizenid) {
    try {
        const res = await axios.post(`${FIVEM_API_URL}/check-online`, { citizenid }, { timeout: BRIDGE_TIMEOUT, headers: headers() });
        return !!res.data.isOnline;
    } catch (e) {
        console.warn(`[Bridge] check-online failed (${e.code || e.message}) - falling back to SQL`);
        return false;
    }
}

// Reports reachability too: "offline" and "unknown" must stay distinguishable
async function fetchOnlinePlayers() {
    try {
        const res = await axios.get(`${FIVEM_API_URL}/get-online-players`, { timeout: BRIDGE_TIMEOUT, headers: headers() });
        const data = res.data;

        // Lua encodes an empty table as []: nobody online, not an error
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

// Throws on success: false, so routes need no per-call check
async function callBridge(route, payload) {
    const res = await axios.post(`${FIVEM_API_URL}${route}`, payload, { timeout: BRIDGE_TIMEOUT, headers: headers() });
    if (res.data && res.data.success === false) {
        const err = new Error(res.data.msg || 'The bridge rejected the action');
        err.bridgeRejected = true;
        throw err;
    }
    return res.data;
}

// Framework, inventory and token state as the game server reports them
async function fetchStatus() {
    try {
        const res = await axios.get(`${FIVEM_API_URL}/status`, { timeout: BRIDGE_TIMEOUT, headers: headers() });
        return { reachable: true, ...res.data };
    } catch (e) {
        return { reachable: false, error: e.code || e.message };
    }
}

module.exports = {
    FIVEM_API_URL, BRIDGE_TIMEOUT, HAS_TOKEN: BRIDGE_TOKEN !== '',
    isPlayerOnline, fetchOnlinePlayers, callBridge, fetchStatus
};
