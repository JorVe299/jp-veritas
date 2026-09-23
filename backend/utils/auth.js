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
//
// The role in that cookie is not frozen at sign-in. The Discord tokens ride
// along, encrypted, and the role is checked against Discord again once a
// SYNC_SECONDS window has passed (see currentSession). Otherwise a role
// taken away in Discord would keep working until the cookie expired.
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

// How stale a session's role may get before Discord is asked again. A
// minute keeps a removed role from lasting, and stays far inside what
// Discord allows per user token.
const SYNC_SECONDS = 60;

// Splits a comma separated list from the environment into clean entries.
function splitList(raw) {
    return String(raw || '').split(',').map(s => s.trim()).filter(Boolean);
}

// --- Role mapping ---------------------------------------------------------
// Two sources, on purpose.
//
// The .env keeps a variable per built-in role. That is the way back in: a
// panel that can edit its own door needs a key kept somewhere it cannot
// reach, and these are read before anything the panel wrote.
//
// Everything else - including every role the owner creates - carries its
// own Discord ids in the role store, edited in the panel.
//
// Whoever matches several roles gets the highest. The ranking is the order
// of the role list, not the order of the .env file.

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

// Order = rank. Read at call time, because roles can be created and
// removed while the panel is running.
function roleOrder() {
    return perms.roleIds();
}

/** Every Discord id mapped to a role, from both sources. */
function mappingFor(roleId) {
    const stored = perms.getRole(roleId);
    return {
        users: (ROLE_BY_USER[roleId] || []).concat(stored ? stored.discordUserIds : []),
        guildRoles: (ROLE_BY_GUILD_ROLE[roleId] || []).concat(stored ? stored.discordRoleIds : []),
    };
}

// The guild scope is needed as soon as any role is assigned via a Discord
// role - not just for one particular one.
function allGuildRoleIds() {
    return roleOrder().flatMap(id => mappingFor(id).guildRoles);
}

/** One line per role, for the startup banner and the diagnostics. */
function mappingSummary() {
    return roleOrder().map(id => {
        const m = mappingFor(id);
        return { id, label: perms.labelOf(id), users: m.users.length, guildRoles: m.guildRoles.length };
    });
}

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

    // The guild scope is needed whenever a guild is configured: the role
    // mapping reads the member's roles, and the portal and the live role
    // check read whether they are a member at all. Without a guild there
    // is nothing to ask, and the consent dialog should not claim otherwise.
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

// Both grants answer in the same shape. The refresh token is kept, because
// the access token runs out after a week and the role sync needs a live one.
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
    // Otherwise the role would depend on the order of the .env file, or on
    // the order somebody happened to create their teams in.
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

// --- Discord tokens in the cookie -----------------------------------------
// The JWT is signed, not encrypted: anybody holding the cookie can read its
// payload. The Discord tokens therefore go in sealed with AES-GCM under a
// key derived from the session secret, so the cookie never hands out a
// token that works against Discord.
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

/**
 * The payload of a session. `exp` is carried over on a re-issue rather
 * than restarted: checking the role again must not also extend the
 * session, or an active tab would never have to sign in again.
 */
function sessionPayload({ user, via, role, portal, tokens, syncedAt, exp }) {
    return {
        sub: user.id,
        username: user.username,
        globalName: user.global_name || null,
        avatar: user.avatar || null,
        via,
        // A portal-only account has no role at all. 'citizen' would be
        // a panel role and would hand it panel access it must not have.
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
        // Looked up rather than mapped from a constant: a session can name
        // a role that has since been deleted, and that has to read as "no
        // label" instead of crashing or inventing one.
        roleLabel: session.role ? perms.labelOf(session.role) : null,
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

// --- Keeping the role current ---------------------------------------------
// A role granted or taken away in Discord has to reach a running session,
// not only the next sign-in. Once SYNC_SECONDS have passed since the last
// check, the next request asks Discord again and the cookie is re-issued
// with whatever the answer now says.
//
// Three outcomes, and the difference between the last two matters:
//
//   updated  Discord answered. Role and portal are what it says now.
//   ended    Discord answered, and nothing is left: no role, no portal. Or
//            the grant behind the tokens is gone. The session ends.
//   kept     Discord could not be asked (down, rate limited, timeout).
//            The session keeps its role and is asked again after a
//            back-off. Locking the whole staff out because Discord is
//            having a bad minute would be the wrong failure.

/** Who is waiting for Discord right now, so one user's tabs share one call. */
const inflight = new Map();
/** Discord id -> ms timestamp before which a failed check is not retried. */
const backoff = new Map();

const ENDED_REVOKED = 'Your Discord authorization for this panel has ended. Sign in again.';
const ENDED_LEGACY = 'Your session predates the live role check. Sign in again once.';

function userOf(session) {
    return {
        id: session.sub,
        username: session.username,
        global_name: session.globalName,
        avatar: session.avatar
    };
}

/** Did Discord refuse the token itself, as opposed to failing to answer? */
function tokenRefused(e) {
    const status = e?.response?.status;
    return status === 401 || status === 403;
}

/**
 * Asks Discord again and decides what the session is now. `deps` is there
 * for the tests; in the running panel it is the real Discord and database.
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
        // A session from before this check carries no tokens, so there is
        // nothing to ask Discord with. Letting it run on unchecked would
        // be exactly the gap this closes, so it signs in again, once.
        if (!tokens) return { kind: 'ended', reason: ENDED_LEGACY };

        try {
            if (tokens.expiresAt && tokens.expiresAt - 60 <= now && tokens.refreshToken) {
                tokens = await d.refreshTokens(tokens.refreshToken);
            }
            try {
                guild = await d.fetchGuildRoles(tokens.accessToken);
            } catch (e) {
                // An access token can be refused before its stated expiry.
                // One refresh, one more try; a refusal after that is final.
                if (!tokenRefused(e) || !tokens.refreshToken) throw e;
                tokens = await d.refreshTokens(tokens.refreshToken);
                guild = await d.fetchGuildRoles(tokens.accessToken);
            }
        } catch (e) {
            const status = e?.response?.status;
            // 400 from the token endpoint is invalid_grant: the user removed
            // the app in Discord, or the refresh token is gone.
            if (tokenRefused(e) || status === 400) return { kind: 'ended', reason: ENDED_REVOKED };
            const retryAfter = Number(e?.response?.data?.retry_after) || 0;
            return { kind: 'kept', retryAfterMs: Math.max(SYNC_SECONDS * 1000, retryAfter * 1000), error: e };
        }
    }

    const user = userOf(session);
    const verdict = authorize(user, guild);

    // The portal hangs off being in the Discord and having a character.
    // Left the Discord: gone. Still in it: ask the database, and if that
    // cannot answer, keep what the session had - a database hiccup must not
    // read as "no characters".
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
    // Required here rather than at the top: it pulls in the database pool,
    // and this module is loaded by tests that never touch a database.
    const { charactersOf } = require('./identity');
    const own = await charactersOf(discordId);
    return Boolean(own && !own.unsupported && own.characters.length > 0);
}

/**
 * The session behind this request, checked against Discord if it is due.
 * Returns { session } or { ended: reason }; re-issues or clears the cookie
 * on the way.
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

// Whether a path is under /api, the way the router sees it. Express matches
// routes without regard to case, so '/API/players' reaches the players
// route - a check on the exact string '/api/' would wave it past the login.
function isApiPath(p) {
    return p.toLowerCase().startsWith('/api/');
}

function isAuthPath(p) {
    return p.toLowerCase().startsWith('/api/auth/');
}

// Guards everything under /api except the auth routes themselves. Static
// files stay open: without a session the served index.html only shows the
// sign-in screen, and the data comes exclusively through /api.
async function requireAuth(req, res, next) {
    if (!ENABLED) return next();
    if (!isApiPath(req.path)) return next();
    if (isAuthPath(req.path)) return next();

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
    ENABLED, GUILD_ID, USES_LEGACY,
    ROLE_BY_USER, ROLE_BY_GUILD_ROLE,
    SESSION_COOKIE, STATE_COOKIE, SESSION_HOURS,
    roleOrder, mappingFor, mappingSummary, allGuildRoleIds,
    SYNC_SECONDS,
    configProblems, buildAuthorizeUrl, exchangeCode, fetchDiscordUser,
    fetchGuildRoles, authorize, issueSession, readSession, clearSession,
    publicUser, cookieOptions, requireAuth, currentSession, syncSession,
    sealTokens, unsealTokens, isApiPath, isAuthPath
};
