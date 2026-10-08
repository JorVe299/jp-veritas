// SECURITY: flood brake for every /api handler (BACKEND.md §4). Shaped for a handful of staff
// plus the FiveM resource, so normal use never reaches it; utils/rateLimit.js stays the
// per-action cooldown behind the refresh buttons

const { ipKeyGenerator } = require('express-rate-limit');
const auth = require('./auth');

const WINDOW_MS = 60_000;

// One panel page opens many requests at once; a staff member stays far under this
const API_PER_WINDOW = 300;

// Sign-in plus the frontend's once-a-minute /api/auth/me poll, across every open tab
const AUTH_PER_WINDOW = 120;

/**
 * One bucket per principal: the signed-in Discord id, the resource, else the address
 * Keeps the resource's start-up sync out of a staff member's bucket (§5)
 */
function keyOf(req) {
    if (req.resource) return 'resource';
    if (req.user?.id) return `user:${req.user.id}`;

    // ipKeyGenerator folds IPv6 into a subnet; an unknown address shares one bucket
    return req.ip ? `ip:${ipKeyGenerator(req.ip)}` : 'ip:unknown';
}

function refusal(req, res) {
    const retryAfter = Math.ceil(WINDOW_MS / 1000);
    res.set('Retry-After', String(retryAfter));
    res.status(429).json({
        success: false,
        error: `Too many requests. Try again in ${retryAfter}s.`,
        retryAfter
    });
}

/** Static files are not /api; the SPA fallback must stay reachable while a flood is refused */
function skipNonApi(req) {
    return !auth.isApiPath(req.path);
}

/** Shared option set; `limit` and `skip` differ per mount point */
function options(limit, skip) {
    const shared = {
        windowMs: WINDOW_MS,
        limit,
        keyGenerator: keyOf,
        handler: refusal,
        standardHeaders: 'draft-7',
        legacyHeaders: false
    };
    return skip ? { ...shared, skip } : shared;
}

/**
 * `trust proxy` for Express: unset means off, so X-Forwarded-For cannot be spoofed
 * A number of hops (`1` behind one TLS terminator) makes req.ip the real client (§5)
 */
function trustProxy() {
    const raw = String(process.env.TRUST_PROXY || '').trim();
    if (raw === '' || raw.toLowerCase() === 'false') return false;
    if (raw.toLowerCase() === 'true') return true;
    if (/^\d+$/.test(raw)) return Number(raw);
    return raw;
}

module.exports = { WINDOW_MS, API_PER_WINDOW, AUTH_PER_WINDOW, keyOf, refusal, skipNonApi, options, trustProxy };
