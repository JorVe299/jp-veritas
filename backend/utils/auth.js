// backend/utils/auth.js
// Discord OAuth2 als Zugangsschutz fuer das Panel.
//
// Bewusst ohne Bot-Token: mit dem Scope 'guilds.members.read' laesst sich die
// Rollenliste des Anmeldenden direkt mit seinem eigenen Access-Token abfragen.
// Ein Bot-Token im Panel waere ein zweites Geheimnis mit deutlich groesserer
// Reichweite, nur um dieselbe Frage zu beantworten.
//
// Die Sitzung ist ein signiertes JWT in einem httpOnly-Cookie. Kein Session-
// Store noetig, damit ueberlebt eine Anmeldung auch einen Neustart des
// Backends - und es entsteht keine zusaetzliche Tabelle in der Qbox-Datenbank.
const crypto = require('crypto');
const axios = require('axios');
const jwt = require('jsonwebtoken');

const DISCORD_API = 'https://discord.com/api/v10';

const CLIENT_ID = process.env.DISCORD_CLIENT_ID || '';
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || '';
const REDIRECT_URI = process.env.DISCORD_REDIRECT_URI || '';
const GUILD_ID = process.env.DISCORD_GUILD_ID || '';

const SESSION_COOKIE = 'veritas_session';
const STATE_COOKIE = 'veritas_oauth_state';
const SESSION_HOURS = parseInt(process.env.SESSION_HOURS) || 12;

// Zugang bekommt, wer in einer der beiden Listen steht. Beide sind einzeln
// optional, aber mindestens eine muss gefuellt sein - sonst koennte sich
// jeder beliebige Discord-Nutzer anmelden.
function splitList(raw) {
    return String(raw || '').split(',').map(s => s.trim()).filter(Boolean);
}

const ADMIN_IDS = splitList(process.env.DISCORD_ADMIN_IDS);
const ADMIN_ROLE_IDS = splitList(process.env.DISCORD_ADMIN_ROLE_IDS);

// Auth ist aktiv, sobald eine Discord-App hinterlegt ist. Fehlt sie, laeuft
// das Panel offen weiter - damit ein unvollstaendiges Deployment nicht alle
// aussperrt. Der Startlog sagt dafuer unuebersehbar Bescheid.
const ENABLED = Boolean(CLIENT_ID && CLIENT_SECRET && REDIRECT_URI);

// Ohne gesetztes Secret waere jedes Cookie faelschbar. Ein zufaelliges Secret
// pro Start ist die sichere Notloesung: es entwertet nur die alten Sitzungen.
const JWT_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const EPHEMERAL_SECRET = !process.env.SESSION_SECRET;

// Fehlkonfigurationen, die das Panel offen lassen oder alle aussperren
// wuerden, ohne dass es auffaellt. Werden beim Start ausgegeben.
function configProblems() {
    const problems = [];

    if (!ENABLED) {
        problems.push('DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET / DISCORD_REDIRECT_URI missing - the panel runs WITHOUT a login.');
        return problems;
    }
    if (ADMIN_IDS.length === 0 && ADMIN_ROLE_IDS.length === 0) {
        problems.push('Neither DISCORD_ADMIN_IDS nor DISCORD_ADMIN_ROLE_IDS is set - nobody would get through.');
    }
    if (ADMIN_ROLE_IDS.length > 0 && !GUILD_ID) {
        problems.push('DISCORD_ADMIN_ROLE_IDS without DISCORD_GUILD_ID - roles cannot be checked.');
    }
    if (EPHEMERAL_SECRET) {
        problems.push('SESSION_SECRET missing - every restart signs everyone out.');
    }
    return problems;
}

// --- OAuth Schritte -------------------------------------------------------

// Der state-Parameter schuetzt gegen untergeschobene Callbacks: wir merken
// ihn uns kurz im Cookie und vergleichen ihn auf dem Rueckweg.
function buildAuthorizeUrl() {
    const state = crypto.randomBytes(16).toString('hex');

    // Den Guild-Scope nur anfragen, wenn wir ihn wirklich brauchen -
    // sonst sieht der Anmeldedialog nach mehr Zugriff aus als noetig.
    const scope = (ADMIN_ROLE_IDS.length > 0 && GUILD_ID)
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

// Rollen des Anmeldenden in der konfigurierten Guild.
// 404 heisst schlicht "nicht auf dem Server" - das ist kein Fehler,
// sondern eine gueltige Antwort auf die Zugangsfrage.
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

// --- Entscheidung ---------------------------------------------------------

function authorize(user, guild) {
    if (ADMIN_IDS.includes(user.id)) {
        return { allowed: true, via: 'user-id' };
    }

    if (ADMIN_ROLE_IDS.length > 0) {
        const hit = guild.roles.find(role => ADMIN_ROLE_IDS.includes(role));
        if (hit) return { allowed: true, via: `role:${hit}` };
    }

    // Der Grund darf konkret sein, ohne die erlaubten IDs zu verraten.
    const reason = (ADMIN_ROLE_IDS.length > 0 && GUILD_ID && !guild.member)
        ? 'You are not a member of the Discord server configured for this panel.'
        : 'Your Discord account has no admin access to this panel.';

    return { allowed: false, reason };
}

// --- Sitzung --------------------------------------------------------------

function cookieOptions(maxAgeMs) {
    return {
        httpOnly: true,
        sameSite: 'lax', // 'lax' laesst den Rueckweg von Discord durch
        // Hinter einem HTTPS-Reverse-Proxy sollte das Cookie secure sein.
        // Ueber http://ip:3001 wuerde secure es unbrauchbar machen, deshalb
        // haengt das an einem eigenen Schalter statt an NODE_ENV.
        secure: process.env.COOKIE_SECURE === 'true',
        maxAge: maxAgeMs,
        path: '/'
    };
}

function issueSession(res, user, via) {
    const token = jwt.sign(
        {
            sub: user.id,
            username: user.username,
            globalName: user.global_name || null,
            avatar: user.avatar || null,
            via
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
        return null; // abgelaufen, manipuliert, oder Secret hat sich geaendert
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
        expiresAt: session.exp ? new Date(session.exp * 1000).toISOString() : null
    };
}

// --- Middleware -----------------------------------------------------------

// Schuetzt alles unter /api ausser den Auth-Routen selbst. Statische Dateien
// bleiben offen: die ausgelieferte index.html zeigt ohne Sitzung nur den
// Anmeldebildschirm, die Daten kommen ausschliesslich ueber /api.
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
    ENABLED, GUILD_ID, ADMIN_IDS, ADMIN_ROLE_IDS,
    SESSION_COOKIE, STATE_COOKIE, SESSION_HOURS,
    configProblems, buildAuthorizeUrl, exchangeCode, fetchDiscordUser,
    fetchGuildRoles, authorize, issueSession, readSession, clearSession,
    publicUser, cookieOptions, requireAuth
};
