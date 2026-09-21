// Explicitly beside this file, not wherever the process happens to have
// been started. Without the path, dotenv resolves against the working
// directory - so a systemd unit or a pm2 entry with a different
// WorkingDirectory finds no .env, and the panel comes up with no database
// settings and, worse, with Discord login switched off because the
// DISCORD_* keys are simply absent. It says so in the log, but a panel
// that quietly opens itself to anyone who can reach the port is not
// something to leave depending on how it was launched.
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { loadGameData, getJobs, getItems, getVehicles } = require('./utils/dataLoader');
const { FIVEM_API_URL } = require('./utils/bridge');
const auth = require('./utils/auth');
const perms = require('./utils/permissions');

const app = express();

// PANEL_ORIGIN is only set in dev and names the Vite server. In production
// the same backend serves the panel - same origin, no CORS needed.
// credentials: true, because otherwise the browser will not send the
// session cookie; '*' would be invalid alongside it anyway.
const PANEL_ORIGIN = process.env.PANEL_ORIGIN || '';
if (PANEL_ORIGIN) {
    app.use(cors({ origin: PANEL_ORIGIN, credentials: true }));
}
app.use(express.json());
app.use(cookieParser());

// Load the game data at startup (before the routes that read the cache)
loadGameData();

// --- Sign-in --------------------------------------------------------------
// The auth routes deliberately come before the middleware: they have to be
// reachable without a session.
app.use(require('./routes/auth').router);
app.use(auth.requireAuth);

// Permissions apply right after sign-in and before every data route.
// A route with no entry in the table is denied, not let through.
app.use(perms.enforce);

// --- Routes ---------------------------------------------------------------
// Everything below requires a valid session, provided Discord auth is
// configured. Each module carries its own full /api/... paths so that the
// file itself shows which URL a route serves.
app.use(require('./routes/me').router);           // Veritas ID - the citizen portal
app.use(require('./routes/players').router);      // player list, single lookup
app.use(require('./routes/manage').router);       // money, job
app.use(require('./routes/vehicles').router);     // vehicles
app.use(require('./routes/inventory').router);    // inventory
app.use(require('./routes/playerdata').router);   // licences, condition, character details
app.use(require('./routes/groups').router);       // jobs and gangs as memberships
app.use(require('./routes/accounts').router);     // bank accounts
app.use(require('./routes/bans').router);         // bans
app.use(require('./routes/actions').router);      // live actions on connected players
app.use(require('./routes/meta').router);         // reference data for dropdowns
app.use(require('./routes/jobs').router);         // jobs and gangs as organisations
app.use(require('./routes/resources').router);    // resource browser, exports
app.use(require('./routes/permissions').router);  // roles and permissions
app.use(require('./routes/system').router);       // diagnostics, schema, refresh

// --- Serving the frontend -------------------------------------------------
// After `npm run build` in frontend/ there is a dist/ folder. Express serves
// it too, so panel and API share one port: the relative /api paths work
// without a proxy, and there is only one port to secure.
// Must come after the API routes so that nothing is shadowed.
const FRONTEND_DIST = path.join(__dirname, '../frontend/dist');
const hasFrontendBuild = fs.existsSync(path.join(FRONTEND_DIST, 'index.html'));

if (hasFrontendBuild) {
    app.use(express.static(FRONTEND_DIST));

    // SPA fallback: anything that is not an API route gets index.html.
    // Deliberately middleware rather than a wildcard route - Express 5
    // requires named wildcards ('/*splat'), this works on any version.
    app.use((req, res, next) => {
        if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
        res.sendFile(path.join(FRONTEND_DIST, 'index.html'));
    });
}

// --- Start ---------------------------------------------------------------

const PORT = process.env.PORT || 3001; // Backend Port
app.listen(PORT, () => {
    console.log(`Backend running on port ${PORT}`);
    console.log(`Bridge expected at ${FIVEM_API_URL}`);
    console.log(`[Data] Jobs: ${Object.keys(getJobs()).length}, Items: ${Object.keys(getItems()).length}, Vehicles: ${Object.keys(getVehicles()).length}`);

    if (auth.ENABLED) {
        const total = auth.ROLE_ORDER.reduce((n, r) =>
            n + auth.ROLE_BY_USER[r].length + auth.ROLE_BY_GUILD_ROLE[r].length, 0);
        console.log(`[Auth] Discord login active - ${total} mapping(s) configured`);
        console.log(`[Auth] Sessions last ${auth.SESSION_HOURS}h`);
        const mapped = auth.ROLE_ORDER
            .map(r => `${r}: ${auth.ROLE_BY_USER[r].length} id(s) / ${auth.ROLE_BY_GUILD_ROLE[r].length} role(s)`)
            .join(', ');
        console.log(`[Perms] ${mapped}`);
    }

    // Misconfigurations must not drown in the log: an open
    // /api/manage/money route is not a detail.
    const problems = auth.configProblems();
    if (problems.length > 0) {
        console.warn('');
        console.warn('  ==================== ATTENTION ====================');
        problems.forEach(p => console.warn(`  !  ${p}`));
        console.warn('  ===================================================');
        console.warn('');
    }

    if (hasFrontendBuild) {
        console.log(`[Web] Panel available at http://localhost:${PORT}`);
    } else {
        console.log('[Web] No frontend build found. API only.');
        console.log('      -> run "npm run build" once inside frontend/');
    }
    console.log('[Diag] GET /api/system/schema checks whether the database fits the modules');

    // Veritas ID tells a player only that the ban record "could not be
    // read" - it must not print server paths at them. Whoever runs the
    // server needs the other half, and needs it without having to sign in
    // and click, so it goes here where the rest of the startup state is.
    require('./utils/txadmin').status().then(tx => {
        if (tx.available) {
            console.log(`[txAdmin] Ban record readable - ${tx.actions} action(s)`);
            console.log(`          ${tx.path}`);
        } else {
            console.log(`[txAdmin] ${tx.reason}`);
            console.log(`          ${tx.hint}`);
            console.log('          Veritas ID will say it could not check, rather than "no bans".');
        }
    }).catch(e => console.log(`[txAdmin] check failed: ${e.message}`));
});
