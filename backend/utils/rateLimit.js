// backend/utils/rateLimit.js
// One request per window, per person, per action.
//
// For the buttons that make the backend do real work on demand - reloading
// the reference data rereads every catalog file from disk. The frontend
// greys those buttons out for the same minute, but a button is a courtesy,
// not a guard: anybody can send the request without it. This is the guard.
//
// In memory on purpose. A restart clearing every cooldown costs nothing,
// and a file or a table for this would be one more thing to keep writable.

/**
 * Who is asking. The signed-in Discord id where there is one; the address
 * otherwise, which is what is left with Discord login switched off.
 */
function whoIs(req) {
    return req.user?.id ? `user:${req.user.id}` : `ip:${req.ip}`;
}

/**
 * Middleware allowing one request per `windowMs` for each person on the
 * action named `name`. A refused request answers 429 with Retry-After, and
 * the same number in the body so the frontend does not have to read a
 * header to say how long is left.
 *
 * Every attempt counts, including one that goes on to fail. Otherwise a
 * request that fails on purpose could be repeated without limit.
 */
function oncePer(name, windowMs, now = Date.now) {
    const last = new Map();

    const middleware = (req, res, next) => {
        const key = whoIs(req);
        const at = now();
        const previous = last.get(key);

        if (previous !== undefined && at - previous < windowMs) {
            const retryAfter = Math.ceil((windowMs - (at - previous)) / 1000);
            res.set('Retry-After', String(retryAfter));
            return res.status(429).json({
                success: false,
                error: `This can only be done once a minute. Try again in ${retryAfter}s.`,
                retryAfter
            });
        }

        last.set(key, at);

        // Entries older than the window grant nothing any more, so they are
        // dropped as they are passed rather than kept for the life of the
        // process.
        for (const [k, t] of last) {
            if (at - t >= windowMs) last.delete(k);
        }
        next();
    };

    middleware.limitName = name;
    return middleware;
}

module.exports = { oncePer, whoIs };
