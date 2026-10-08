// oncePer(): one request per window, per person, per action (in memory; a restart resets it)
// The server-side guard behind the frontend's refresh cooldowns (BACKEND.md §4)

/** Discord id when signed in, the resource for its secret, else the IP (login disabled) */
function whoIs(req) {
    // The resource shares the panel's host; an admin refresh must not spend its window
    if (req.resource) return 'resource';
    return req.user?.id ? `user:${req.user.id}` : `ip:${req.ip}`;
}

/**
 * One request per `windowMs` per person for action `name`; 429 + Retry-After otherwise
 * retryAfter is repeated in the body; failed attempts count too (no free retries)
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

        // Expired entries are pruned on the way; the map stays small
        for (const [k, t] of last) {
            if (at - t >= windowMs) last.delete(k);
        }
        next();
    };

    middleware.limitName = name;
    return middleware;
}

module.exports = { oncePer, whoIs };
