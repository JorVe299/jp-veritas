// The FiveM resource as a principal of its own: no session, one shared secret (BACKEND.md §5)
// SECURITY: a secret, never an exemption by path; the capability list below is the whole reach

const crypto = require('crypto');

const HEADER = 'x-veritas-secret';

// What the resource may reach; its start-up sync needs the catalog reload and nothing else
const CAPABILITIES = ['system.edit'];

/** RESOURCE_SECRET, trimmed; read per request so a test can set it */
function configuredSecret() {
    return (process.env.RESOURCE_SECRET || '').trim();
}

// SECURITY: digests make the compare length-blind as well as constant-time
function equals(given, expected) {
    const a = crypto.createHash('sha256').update(given, 'utf8').digest();
    const b = crypto.createHash('sha256').update(expected, 'utf8').digest();
    return crypto.timingSafeEqual(a, b);
}

/** Whether `given` is the configured secret; fails closed on an unset or empty one */
function matches(given) {
    const expected = configuredSecret();
    if (expected === '') return false;
    if (typeof given !== 'string' || given === '') return false;
    return equals(given, expected);
}

/** Whether the resource principal may do `capability` */
function allows(capability) {
    return CAPABILITIES.includes(capability);
}

// SECURITY: a header that does not match ends the request; a sender with a wrong
// secret never falls back to being treated as an anonymous caller
function identify(req, res, next) {
    const given = req.headers[HEADER];
    if (given === undefined) return next();

    if (!matches(given)) {
        return res.status(401).json({
            error: 'The resource secret does not match',
            authenticated: false,
            hint: 'RESOURCE_SECRET in backend/.env and Config.BackendSecret in the resource must be the same non-empty value.'
        });
    }

    req.resource = { capabilities: CAPABILITIES };
    next();
}

module.exports = { HEADER, CAPABILITIES, configuredSecret, matches, allows, identify };
