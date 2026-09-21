// backend/utils/auth.js
// Discord OAuth2 as the access gate for the panel.
//
// Deliberately without a bot token: the 'guilds.members.read' scope lets us
// read the signing-in user's own role list with their own access token. A
// bot token in the panel would be a second secret with far wider reach,
// just to answer the same question.
//
// The session is a signed JWT in an httpOnly cookie. No session store is
// needed, so a login survives a restart of the backend - and no extra table
// appears in the Qbox database.
const crypto = require('crypto');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const { ROLE_LABELS, capabilitiesOf } = require('./permissions');

const DISCORD_API = 'https://discord.com/api/v10';

const CLIENT_ID = process.env.DISCORD_CLIENT_ID || '';
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || '';
const REDIRECT_URI = process.env.DISCORD_REDIRECT_URI || '';
const GUILD_ID = process.env.DISCORD_GUILD_ID || '';

const SESSION_COOKIE = 'veritas_session';
const STATE_COOKIE = 'veritas_oauth_state';
const SESSION_HOURS = parseInt(process.env.SESSION_HOURS) || 12;

// Splits a comma separated list from the environment into clean entries.
function splitList(raw) {
    return String(raw || '').split(',').map(s => s.trim()).filter(Boolean);
}

// --- Role mapping ---------------------------------------------------------
// Exactly one variable per role and per way of assigning it. Whoever
// matches several gets the highest - the ranking lives in ROLE_ORDER, not
// in the order of the .env file.

// Before roles existed there were only these two lists, and whoever was in
// them could do everything. They are still read so that a server with an
// old .env does not suddenly let nobody in after the update - but they now
// mean exactly one thing: owner.
const LEGACY_IDS = splitList(process.env.DISCORD_ADMIN_IDS);
const LEGACY_ROLE_IDS = splitList(process.env.DISCORD_ADMIN_ROLE_IDS);
const USES_LEGACY = LEGACY_IDS.length > 0 || LEGACY_ROLE_IDS.length > 0;

const ROLE_BY_USER = {
    owner: splitList(process.env.DISCORD_OWNER_IDS).concat(LEGACY_IDS),
    administrator: splitList(process.env.DISCORD_ADMINISTRATOR_IDS),
    supporter: splitList(process.env.DISCORD_SUPPORTER_IDS),
    citizen: splitList(process.env.DISCORD_CITIZEN_IDS)
};

const ROLE_BY_GUILD_ROLE = {
    owner: splitList(process.env.DISCORD_ROLE_OWNER).concat(LEGACY_ROLE_IDS),
    administrator: splitList(process.env.DISCORD_ROLE_ADMINISTRATOR),
    supporter: splitList(process.env.DISCORD_ROLE_SUPPORTER),
    citizen: splitList(process.env.DISCORD_ROLE_CITIZEN)
};

// Order = rank. The first match wins.
const ROLE_ORDER = ['owner', 'administrator', 'supporter', 'citizen'];

// The guild scope is needed as soon as any role is assigned via Discord
// roles - not just for one particular one.
const ALL_ROLE_IDS = ROLE_ORDER.flatMap(r => ROLE_BY_GUILD_ROLE[r]);

// Auth is active as soon as a Discord app is configured. Without one the
// panel keeps running open, so that an incomplete deployment does not lock
// everyone out. The startup log says so unmistakably in return.
const ENABLED = Boolean(CLIENT_ID && CLIENT_SECRET && REDIRECT_URI);

// Without a configured secret every cookie would be forgeable. A random
// secret per start is the safe fallback: it only invalidates old sessions.
const JWT_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const EPHEMERAL_SECRET = !process.env.SESSION_SECRET;

// Misconfigurations that would leave the panel open or lock everyone out
// without it being noticed. Printed at startup.
function configProblems() {
    const problems = [];

    if (!ENABLED) {
        problems.push('DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET / DISCORD_REDIRECT_URI missing - the panel runs WITHOUT a login.');
        return problems;
    }
    const anyUser = ROLE_ORDER.some(r => ROLE_BY_USER[r].length > 0);
    if (!anyUser && ALL_ROLE_IDS.length === 0) {
        problems.push('No Discord ids or roles are mapped to a panel role - nobody would get through.');
    }
    if (ALL_ROLE_IDS.length > 0 && !GUILD_ID) {
        problems.push('Discord roles are mapped but DISCORD_GUILD_ID is missing - roles cannot be checked.');
    }
    if (ROLE_BY_USER.owner.length === 0 && ROLE_BY_GUILD_ROLE.owner.length === 0) {
        problems.push('Nobody is mapped to Owner - then nobody can change permissions.');
    }
    if (EPHEMERAL_SECRET) {
        problems.push('SESSION_SECRET missing - every restart signs everyone out.');
    }
    if (USES_LEGACY) {
        problems.push('DISCORD_ADMIN_IDS / DISCORD_ADMIN_ROLE_IDS are deprecated and are being read as Owner.'
            + ' Rename them to DISCORD_OWNER_IDS / DISCORD_ROLE_OWNER (or to the role you actually want).');
    }
    return problems;
}

// --- OAuth steps ----------------------------------------------------------

// The state parameter guards against planted callbacks: we keep it in a
// short-lived cookie and compare it on the way back.
function buildAuthorizeUrl() {
    const state = crypto.randomBytes(16).toString('hex');

    // Only request the guild scope when we actually need it - otherwise
    // the consent dialog looks like it asks for more access than it does.
    const scope = (ALL_ROLE_IDS.length > 0 && GUILD_ID)
        ? 'identify guilds.members.read'
        : 'identify';

    const params = new URLSearchParams({
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        response_type: 'code',
        scope,
        state
    });

    return { url: `${DISCORD_API}/oauth2/authorize?${params.toString()}`, state };
}

async function exchangeCode(code) {
    const body = new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI
    });

    const res = await axios.post(`${DISCORD_API}/oauth2/token`, body.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 10000
    });
    return res.data.access_token;
}

async function fetchDiscordUser(accessToken) {
    const res = await axios.get(`${DISCORD_API}/users/@me`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: 10000
    });
    return res.data;
}

// The signing-in user's roles in the configured guild.
// A 404 simply means "not on that server" - that is not an error but a
// valid answer to the access question.
async function fetchGuildRoles(accessToken) {
    if (!GUILD_ID) return { member: false, roles: [] };

    try {
        const res = await axios.get(`${DISCORD_API}/users/@me/guilds/${GUILD_ID}/member`, {
            headers: { Authorization: `Bearer ${accessToken}` },
            timeout: 10000
        });
        return { member: true, roles: Array.isArray(res.data.roles) ? res.data.roles : [] };
    } catch (e) {
        if (e.response?.status === 404) return { member: false, roles: [] };
        throw e;
    }
}

// --- Decision -------------------------------------------------------------

function authorize(user, guild) {
    // Top down: whoever matches several roles gets the highest one.
    // Otherwise the role would depend on the order of the .env file.
    for (const role of ROLE_ORDER) {
        if (ROLE_BY_USER[role].includes(user.id)) {
            return { allowed: true, role, via: 'user-id' };
        }
        const hit = guild.roles.find(r => ROLE_BY_GUILD_ROLE[role].includes(r));
        if (hit) {
            return { allowed: true, role, via: `role:${hit}` };
        }
    }

    // No panel role. That is not a rejection any more: the same account may
    // still be a citizen using Veritas ID. The callback decides that, since
    // it needs the database to see whether a character exists.
    return { allowed: false, role: null };
}

// --- Session --------------------------------------------------------------

function cookieOptions(maxAgeMs) {
    return {
        httpOnly: true,
        sameSite: 'lax', // 'lax' lets the return trip from Discord through
        // Behind an HTTPS reverse proxy the cookie should be secure.
        // Over http://ip:3001 the secure flag would make it useless, so it
        // hangs off its own switch rather than off NODE_ENV.
        secure: process.env.COOKIE_SECURE === 'true',
        maxAge: maxAgeMs,
        path: '/'
    };
}

function issueSession(res, user, via, role, portal) {
    const token = jwt.sign(
        {
            sub: user.id,
            username: user.username,
            globalName: user.global_name || null,
            avatar: user.avatar || null,
            via,
            // A portal-only account has no role at all. 'citizen' would be
            // a panel role and would hand it panel access it must not have.
            role: role || null,
            portal: portal === true
        },
        JWT_SECRET,
        { expiresIn: `${SESSION_HOURS}h` }
    );

    res.cookie(SESSION_COOKIE, token, cookieOptions(SESSION_HOURS * 3600 * 1000));
}

function readSession(req) {
    const token = req.cookies && req.cookies[SESSION_COOKIE];
    if (!token) return null;
    try {
        return jwt.verify(token, JWT_SECRET);
    } catch {
        return null; // expired, tampered with, or the secret changed
    }
}

function clearSession(res) {
    res.clearCookie(SESSION_COOKIE, { path: '/' });
}

function publicUser(session) {
    if (!session) return null;
    return {
        id: session.sub,
        username: session.username,
        globalName: session.globalName,
        avatarUrl: session.avatar
            ? `https://cdn.discordapp.com/avatars/${session.sub}/${session.avatar}.png?size=64`
            : null,
        via: session.via,
        role: session.role || null,
        roleLabel: session.role ? ROLE_LABELS[session.role] : null,
        portal: session.portal === true,
        // A session minted before Veritas ID existed carries no portal
        // field at all. That is not the same as "not allowed": it is an
        // answer nobody ever gave. Collapsing the two into false makes a
        // stale cookie look exactly like a refusal, and the person is then
        // told something untrue about their account.
        portalKnown: session.portal !== undefined,
        // The role's current capability list, not the one from sign-in:
        // a change to the matrix therefore takes effect immediately,
        // without everyone having to sign in again.
        capabilities: session.role ? capabilitiesOf(session.role) : [],
        expiresAt: session.exp ? new Date(session.exp * 1000).toISOString() : null
    };
}

// --- Middleware -----------------------------------------------------------

// Guards everything under /api except the auth routes themselves. Static
// files stay open: without a session the served index.html only shows the
// sign-in screen, and the data comes exclusively through /api.
function requireAuth(req, res, next) {
    if (!ENABLED) return next();
    if (!req.path.startsWith('/api/')) return next();
    if (req.path.startsWith('/api/auth/')) return next();

    const session = readSession(req);
    if (!session) {
        return res.status(401).json({
            error: 'Not signed in',
            authenticated: false,
            loginUrl: '/api/auth/login'
        });
    }

    req.user = publicUser(session);
    next();
}

module.exports = {
    ENABLED, GUILD_ID, USES_LEGACY,
    ROLE_ORDER, ROLE_BY_USER, ROLE_BY_GUILD_ROLE,
    SESSION_COOKIE, STATE_COOKIE, SESSION_HOURS,
    configProblems, buildAuthorizeUrl, exchangeCode, fetchDiscordUser,
    fetchGuildRoles, authorize, issueSession, readSession, clearSession,
    publicUser, cookieOptions, requireAuth
};
