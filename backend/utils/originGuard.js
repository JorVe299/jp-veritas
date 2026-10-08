// SECURITY: token-free CSRF defence (BACKEND.md §4): a state-changing /api request must name
// this panel's host in Origin or Referer; a cross-site page cannot forge either, and the
// session cookie's SameSite=Lax already keeps it off most cross-site requests

const resourceAuth = require('./resourceAuth');

// Nothing here changes state; GET stays reachable so the panel and the SPA fallback work
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const REFUSED = 'This request did not come from the panel and was refused.';

/** Host part of an absolute URL, lower-cased; null when it is not one */
function hostOf(url) {
    try {
        return new URL(String(url)).host.toLowerCase();
    } catch {
        return null;
    }
}

/**
 * Hosts a state-changing request may claim to come from
 * Compared by host, not by scheme: a TLS terminator forwards http to this process (§7)
 */
function allowedHosts(req) {
    const hosts = [req.headers.host, req.headers['x-forwarded-host']]
        .filter(h => typeof h === 'string' && h)
        .flatMap(h => h.split(',').map(one => one.trim().toLowerCase()))
        .filter(Boolean);

    // Vite dev server: a different origin by design (PANEL_ORIGIN, §5)
    const panel = hostOf(process.env.PANEL_ORIGIN || '');
    if (panel) hosts.push(panel);
    return hosts;
}

/** The host this request says it came from; Origin first, Referer as the fallback */
function claimedHost(req) {
    const origin = req.headers.origin;
    if (typeof origin === 'string' && origin && origin !== 'null') return hostOf(origin);
    return hostOf(req.headers.referer || '');
}

// SECURITY: a request carrying the resource secret header is exempt, because a cross-site
// page cannot set a custom header without a preflight this backend never approves (§5)
function guard(req, res, next) {
    if (SAFE_METHODS.has(req.method)) return next();
    if (!String(req.path).toLowerCase().startsWith('/api/')) return next();
    if (req.headers[resourceAuth.HEADER] !== undefined) return next();

    const claimed = claimedHost(req);
    if (claimed && allowedHosts(req).includes(claimed)) return next();

    // Neither header present means a client that is not a browser; browsers always send Origin
    console.warn(`[CSRF] ${req.method} ${req.path} refused - origin ${claimed || 'absent'}`);
    return res.status(403).json({
        success: false,
        error: REFUSED,
        origin: claimed || null
    });
}

module.exports = { guard, SAFE_METHODS, REFUSED, allowedHosts, claimedHost };
