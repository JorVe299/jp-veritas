// Discord OAuth2 sign-in, session cookie, role resolution
// No bot token: 'guilds.members.read' reads the user's own roles with their own token
// Stateless session (signed JWT, httpOnly cookie): survives restarts, no table in the game DB
const crypto = require('crypto');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const perms = require('./permissions');
const { capabilitiesOf } = perms;

const DISCORD_API = 'https://discord.com/api/v10';

const CLIENT_ID = process.env.DISCORD_CLIENT_ID || '';
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || '';
const REDIRECT_URI = process.env.DISCORD_REDIRECT_URI || '';
const GUILD_ID = process.env.DISCORD_GUILD_ID || '';

const SESSION_COOKIE = 'veritas_session';
const STATE_COOKIE = 'veritas_oauth_state';
const SESSION_HOURS = parseInt(process.env.SESSION_HOURS) || 12;

// Max role age before Discord is re-asked; well under its per-token rate limit
const SYNC_SECONDS = 60;

function splitList(raw) {
    return String(raw || '').split(',').map(s => s.trim()).filter(Boolean);
}

// --- Role mapping ---------------------------------------------------------
// Sources: .env per built-in role (the way back in, BACKEND.md §4) + role store
// Several matches: highest rank wins (role list order, not .env order)

const ROLE_BY_USER = {
    owner: splitList(process.env.DISCORD_OWNER_IDS),
    administrator: splitList(process.env.DISCORD_ADMINISTRATOR_IDS),
    supporter: splitList(process.env.DISCORD_SUPPORTER_IDS),
    citizen: splitList(process.env.DISCORD_CITIZEN_IDS)
};

const ROLE_BY_GUILD_ROLE = {
    owner: splitList(process.env.DISCORD_ROLE_OWNER),
    administrator: splitList(process.env.DISCORD_ROLE_ADMINISTRATOR),
    supporter: splitList(process.env.DISCORD_ROLE_SUPPORTER),
    citizen: splitList(process.env.DISCORD_ROLE_CITIZEN)
};

// Order = rank; read per call since roles change at runtime
function roleOrder() {
    return perms.roleIds();
}

/** Every Discord id mapped to a role, from both sources */
function mappingFor(roleId) {
    const stored = perms.getRole(roleId);
    return {
        users: (ROLE_BY_USER[roleId] || []).concat(stored ? stored.discordUserIds : []),
        guildRoles: (ROLE_BY_GUILD_ROLE[roleId] || []).concat(stored ? stored.discordRoleIds : []),
    };
}

// Any entry here makes DISCORD_GUILD_ID mandatory
function allGuildRoleIds() {
    return roleOrder().flatMap(id => mappingFor(id).guildRoles);
}

/** Per-role mapping counts for the startup banner and diagnostics */
function mappingSummary() {
    return roleOrder().map(id => {
        const m = mappingFor(id);
        return { id, label: perms.labelOf(id), users: m.users.length, guildRoles: m.guildRoles.length };
    });
}

// No Discord app: panel runs open (startup warns) rather than locking everyone out
const ENABLED = Boolean(CLIENT_ID && CLIENT_SECRET && REDIRECT_URI);

// No SESSION_SECRET: random per start; cookies stay unforgeable, restarts sign everyone out
const JWT_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const EPHEMERAL_SECRET = !process.env.SESSION_SECRET;

/** Misconfigurations that silently open the panel or lock everyone out; printed at startup */
function configProblems() {
    const problems = [];

    if (!ENABLED) {
        problems.push('DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET / DISCORD_REDIRECT_URI missing - the panel runs WITHOUT a login.');
        return problems;
    }
    const summary = mappingSummary();
    const guildRoleIds = allGuildRoleIds();
    if (summary.every(r => r.users === 0) && guildRoleIds.length === 0) {
        problems.push('No Discord ids or roles are mapped to a panel role - nobody would get through.');
    }
    if (guildRoleIds.length > 0 && !GUILD_ID) {
        problems.push('Discord roles are mapped but DISCORD_GUILD_ID is missing - roles cannot be checked.');
    }
    const owner = mappingFor(perms.OWNER_ROLE);
    if (owner.users.length === 0 && owner.guildRoles.length === 0) {
        problems.push('Nobody is mapped to Owner - then nobody can change permissions.');
    }
    if (EPHEMERAL_SECRET) {
        problems.push('SESSION_SECRET missing - every restart signs everyone out.');
    }
    return problems;
}

// --- OAuth steps ----------------------------------------------------------

// SECURITY: 'state' goes into a short-lived cookie and is compared on the callback (CSRF)
function buildAuthorizeUrl() {
    const state = crypto.randomBytes(16).toString('hex');

    // Guild scope only if a guild is configured (roles, membership); else identity only
    const scope = GUILD_ID
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

// Refresh token kept: access tokens expire after a week, the role sync needs a live one
async function requestTokens(grant) {
    const body = new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        ...grant
    });

    const res = await axios.post(`${DISCORD_API}/oauth2/token`, body.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 10000
    });
    return {
        accessToken: res.data.access_token,
        refreshToken: res.data.refresh_token || null,
        expiresAt: Math.floor(Date.now() / 1000) + (Number(res.data.expires_in) || 0)
    };
}

function exchangeCode(code) {
    return requestTokens({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI });
}

function refreshTokens(refreshToken) {
    return requestTokens({ grant_type: 'refresh_token', refresh_token: refreshToken });
}

async function fetchDiscordUser(accessToken) {
    const res = await axios.get(`${DISCORD_API}/users/@me`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: 10000
    });
    return res.data;
}

// 404 = not a guild member: an answer, not an error
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
    // Rank order: several matches resolve to the highest role
    for (const role of roleOrder()) {
        const { users, guildRoles } = mappingFor(role);
        if (users.includes(user.id)) {
            return { allowed: true, role, via: 'user-id' };
        }
        const hit = guild.roles.find(r => guildRoles.includes(r));
        if (hit) {
            return { allowed: true, role, via: `role:${hit}` };
        }
    }

    // No panel role is no rejection: the callback checks for a portal character (needs the DB)
    return { allowed: false, role: null };
}

// --- Session --------------------------------------------------------------

function cookieOptions(maxAgeMs) {
    return {
        httpOnly: true,
        sameSite: 'lax', // lax: lets the OAuth return from Discord carry the cookie
        // Own switch, not NODE_ENV: a secure cookie is dropped on plain http://ip:3001
        secure: process.env.COOKIE_SECURE === 'true',
        maxAge: maxAgeMs,
        path: '/'
    };
}

// --- Discord tokens in the cookie -----------------------------------------
// SECURITY: JWT payload is readable, so tokens are sealed (AES-256-GCM, key from SESSION_SECRET)
const TOKEN_KEY = crypto.createHash('sha256').update(`veritas-discord-tokens:${JWT_SECRET}`).digest();

function sealTokens(tokens) {
    if (!tokens?.accessToken) return null;
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', TOKEN_KEY, iv);
    const plain = JSON.stringify({ a: tokens.accessToken, r: tokens.refreshToken || null, e: tokens.expiresAt || 0 });
    const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
}

function unsealTokens(sealed) {
    if (typeof sealed !== 'string' || !sealed) return null;
    try {
        const raw = Buffer.from(sealed, 'base64url');
        const decipher = crypto.createDecipheriv('aes-256-gcm', TOKEN_KEY, raw.subarray(0, 12));
        decipher.setAuthTag(raw.subarray(12, 28));
        const plain = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
        const t = JSON.parse(plain);
        return { accessToken: t.a, refreshToken: t.r || null, expiresAt: Number(t.e) || 0 };
    } catch {
        return null; // tampered with, or sealed under another secret
    }
}

/** Session payload; a re-issue keeps `exp`, so a role check never extends the session */
function sessionPayload({ user, via, role, portal, tokens, syncedAt, exp }) {
    return {
        sub: user.id,
        username: user.username,
        globalName: user.global_name || null,
        avatar: user.avatar || null,
        via,
        // SECURITY: portal-only accounts get null, not 'citizen' (a panel role)
        role: role || null,
        portal: portal === true,
        dt: sealTokens(tokens),
        syncedAt: syncedAt || Math.floor(Date.now() / 1000),
        exp: exp || Math.floor(Date.now() / 1000) + SESSION_HOURS * 3600
    };
}

function writeSession(res, payload) {
    const token = jwt.sign(payload, JWT_SECRET);
    const left = Math.max(0, payload.exp * 1000 - Date.now());
    res.cookie(SESSION_COOKIE, token, cookieOptions(left));
}

function issueSession(res, user, via, role, portal, tokens) {
    writeSession(res, sessionPayload({ user, via, role, portal, tokens }));
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
        // Looked up per request: the role may have been deleted since sign-in
        roleLabel: session.role ? perms.labelOf(session.role) : null,
        portal: session.portal === true,
        // Current capabilities, not those at sign-in: matrix changes apply immediately
        capabilities: session.role ? capabilitiesOf(session.role) : [],
        expiresAt: session.exp ? new Date(session.exp * 1000).toISOString() : null
    };
}

// --- Keeping the role current ---------------------------------------------
// Re-checked against Discord once per SYNC_SECONDS; the cookie is re-issued with the result

/** Discord id -> pending sync; one user's tabs share one Discord call */
const inflight = new Map();
/** Discord id -> ms timestamp before which a failed check is not retried */
const backoff = new Map();

const ENDED_REVOKED = 'Your Discord authorization for this panel has ended. Sign in again.';
const ENDED_UNCHECKABLE = 'Your session could not be checked against Discord. Sign in again.';

function userOf(session) {
    return {
        id: session.sub,
        username: session.username,
        global_name: session.globalName,
        avatar: session.avatar
    };
}

/** Token refused (401/403), as opposed to Discord failing to answer */
function tokenRefused(e) {
    const status = e?.response?.status;
    return status === 401 || status === 403;
}

/**
 * Re-asks Discord: 'updated' (answered) | 'ended' (nothing left, grant revoked) | 'kept'
 * kept = Discord unreachable: role stays, retry after back-off (an outage locks nobody out)
 * `deps` replaces Discord and the DB in tests
 */
async function syncSession(session, deps = {}) {
    const d = {
        fetchGuildRoles,
        refreshTokens,
        hasCharacters: defaultHasCharacters,
        now: () => Math.floor(Date.now() / 1000),
        guildId: GUILD_ID,
        ...deps
    };
    const now = d.now();
    let tokens = unsealTokens(session.dt);
    let guild = { member: false, roles: [] };

    if (d.guildId) {
        // SECURITY: no tokens = uncheckable; the session ends instead of running on unchecked
        if (!tokens) return { kind: 'ended', reason: ENDED_UNCHECKABLE };

        try {
            if (tokens.expiresAt && tokens.expiresAt - 60 <= now && tokens.refreshToken) {
                tokens = await d.refreshTokens(tokens.refreshToken);
            }
            try {
                guild = await d.fetchGuildRoles(tokens.accessToken);
            } catch (e) {
                // Refused before stated expiry: one refresh + retry, then final
                if (!tokenRefused(e) || !tokens.refreshToken) throw e;
                tokens = await d.refreshTokens(tokens.refreshToken);
                guild = await d.fetchGuildRoles(tokens.accessToken);
            }
        } catch (e) {
            const status = e?.response?.status;
            // 400 from the token endpoint = invalid_grant (app removed, or refresh token gone)
            if (tokenRefused(e) || status === 400) return { kind: 'ended', reason: ENDED_REVOKED };
            const retryAfter = Number(e?.response?.data?.retry_after) || 0;
            return { kind: 'kept', retryAfterMs: Math.max(SYNC_SECONDS * 1000, retryAfter * 1000), error: e };
        }
    }

    const user = userOf(session);
    const verdict = authorize(user, guild);

    // Portal = guild member with a character
    // DB error keeps the previous flag: a hiccup must not read as "no characters"
    let portal = false;
    if (guild.member) {
        try {
            portal = await d.hasCharacters(user.id);
        } catch {
            portal = session.portal === true;
        }
    }

    if (!verdict.allowed && !portal) {
        return {
            kind: 'ended',
            reason: d.guildId && !guild.member
                ? 'You are no longer a member of the Discord server for this community.'
                : 'This Discord account no longer has a panel role or a character on this server.'
        };
    }

    return {
        kind: 'updated',
        payload: sessionPayload({
            user,
            via: verdict.via || 'portal',
            role: verdict.role,
            portal,
            tokens,
            syncedAt: now,
            exp: session.exp
        })
    };
}

async function defaultHasCharacters(discordId) {
    // Lazy: pulls in the DB pool; tests load this module without a database
    const { charactersOf } = require('./identity');
    const own = await charactersOf(discordId);
    return Boolean(own && !own.unsupported && own.characters.length > 0);
}

/**
 * Session of this request, re-checked against Discord when due; re-issues or clears the cookie
 * @returns {{session: object|null, ended?: string}}
 */
async function currentSession(req, res) {
    const session = readSession(req);
    if (!session) return { session: null };

    const now = Math.floor(Date.now() / 1000);
    if (session.syncedAt && now - session.syncedAt < SYNC_SECONDS) return { session };
    if ((backoff.get(session.sub) || 0) > Date.now()) return { session };

    let job = inflight.get(session.sub);
    if (!job) {
        job = syncSession(session).finally(() => inflight.delete(session.sub));
        inflight.set(session.sub, job);
    }
    const outcome = await job;

    if (outcome.kind === 'kept') {
        backoff.set(session.sub, Date.now() + outcome.retryAfterMs);
        console.warn(`[Auth] role check for ${session.username} (${session.sub}) could not reach Discord`
            + ` (${outcome.error?.response?.status || outcome.error?.message}) - keeping the current role for now`);
        return { session };
    }
    backoff.delete(session.sub);

    if (outcome.kind === 'ended') {
        console.log(`[Auth] session ended: ${session.username} (${session.sub}) - ${outcome.reason}`);
        clearSession(res);
        return { session: null, ended: outcome.reason };
    }

    const next = outcome.payload;
    if (next.role !== (session.role || null) || next.portal !== (session.portal === true)) {
        console.log(`[Auth] role changed: ${session.username} (${session.sub})`
            + ` role ${session.role || '-'} -> ${next.role || '-'}, portal ${session.portal === true} -> ${next.portal}`);
    }
    writeSession(res, next);
    return { session: next };
}

// --- Middleware -----------------------------------------------------------

// SECURITY: case-insensitive like Express routing; '/API/players' must not skip the login
function isApiPath(p) {
    return p.toLowerCase().startsWith('/api/');
}

function isAuthPath(p) {
    return p.toLowerCase().startsWith('/api/auth/');
}

// Guards /api except /api/auth; static files stay public (data only flows through /api)
async function requireAuth(req, res, next) {
    if (!ENABLED) return next();
    if (!isApiPath(req.path)) return next();
    if (isAuthPath(req.path)) return next();

    // SECURITY: set only by a matching resource secret; enforce() still gates what it may do
    if (req.resource) return next();

    const { session, ended } = await currentSession(req, res);
    if (!session) {
        return res.status(401).json({
            error: ended || 'Not signed in',
            authenticated: false,
            loginUrl: '/api/auth/login'
        });
    }

    req.user = publicUser(session);
    next();
}

module.exports = {
    ENABLED, GUILD_ID,
    ROLE_BY_USER, ROLE_BY_GUILD_ROLE,
    SESSION_COOKIE, STATE_COOKIE, SESSION_HOURS,
    roleOrder, mappingFor, mappingSummary, allGuildRoleIds,
    SYNC_SECONDS,
    configProblems, buildAuthorizeUrl, exchangeCode, fetchDiscordUser,
    fetchGuildRoles, authorize, issueSession, readSession, clearSession,
    publicUser, cookieOptions, requireAuth, currentSession, syncSession,
    sealTokens, unsealTokens, isApiPath, isAuthPath
};
