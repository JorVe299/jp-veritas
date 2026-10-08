// SECURITY: explicit path; dotenv resolves against the cwd, and a service started elsewhere
// would come up without .env: no DB settings and Discord login off (BACKEND.md §5)
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { rateLimit } = require('express-rate-limit');
const { loadGameData, getJobs, getItems, getVehicles } = require('./utils/dataLoader');
const { FIVEM_API_URL } = require('./utils/bridge');
const auth = require('./utils/auth');
const perms = require('./utils/permissions');
const resourceAuth = require('./utils/resourceAuth');
const originGuard = require('./utils/originGuard');
const limits = require('./utils/apiLimits');

const app = express();

// SECURITY: off unless configured; otherwise a client could claim any address in
// X-Forwarded-For and get a rate-limit bucket per forged hop (BACKEND.md §5)
app.set('trust proxy', limits.trustProxy());

// CORS for the Vite dev server only; production is same-origin
// credentials: the session cookie must be sent (rules out origin '*')
const PANEL_ORIGIN = process.env.PANEL_ORIGIN || '';
if (PANEL_ORIGIN) {
    app.use(cors({ origin: PANEL_ORIGIN, credentials: true }));
}
app.use(express.json());
app.use(cookieParser());

// SECURITY: CSRF defence for every state-changing /api request; before the sign-in routes,
// so POST /api/auth/logout is covered too (BACKEND.md §4)
app.use(originGuard.guard);

// Before the routes that read the cache
loadGameData();

// --- Sign-in --------------------------------------------------------------
// SECURITY: own bucket; sign-in runs before requireAuth, so there is no id to key on yet
app.use('/api/auth', rateLimit(limits.options(limits.AUTH_PER_WINDOW)));

// Auth routes before requireAuth: reachable without a session
app.use(require('./routes/auth').router);

// SECURITY: before requireAuth, so the resource's own secret stands in for a session;
// it still passes enforce(), which holds it to its capability list (BACKEND.md §5)
app.use(resourceAuth.identify);
app.use(auth.requireAuth);

// SECURITY: flood brake for every data route; after requireAuth, so the bucket is the
// signed-in Discord id rather than one shared address behind a proxy (BACKEND.md §4)
app.use(rateLimit(limits.options(limits.API_PER_WINDOW, limits.skipNonApi)));

// SECURITY: enforce() before every data route; a route without a rule is denied
app.use(perms.enforce);

// --- Routes ---------------------------------------------------------------
// Session required (when login is configured); each module declares full /api/... paths
app.use(require('./routes/me').router);           // Veritas ID - the citizen portal
app.use(require('./routes/players').router);      // player list, single lookup
app.use(require('./routes/manage').router);       // money, job
app.use(require('./routes/vehicles').router);     // vehicles
app.use(require('./routes/inventory').router);    // inventory
app.use(require('./routes/playerdata').router);   // licences, condition, character details
app.use(require('./routes/characters').router);   // deleting a character
app.use(require('./routes/groups').router);       // jobs and gangs as memberships
app.use(require('./routes/accounts').router);     // bank accounts
app.use(require('./routes/bans').router);         // bans
app.use(require('./routes/actions').router);      // live actions on connected players
app.use(require('./routes/meta').router);         // reference data for dropdowns
app.use(require('./routes/jobs').router);         // jobs and gangs as organisations
app.use(require('./routes/permissions').router);  // roles and permissions
app.use(require('./routes/system').router);       // diagnostics, schema, refresh

// --- Serving the frontend -------------------------------------------------
// frontend/dist on the API's port: no proxy, one port to secure; after the API routes
const FRONTEND_DIST = path.join(__dirname, '../frontend/dist');
const hasFrontendBuild = fs.existsSync(path.join(FRONTEND_DIST, 'index.html'));

if (hasFrontendBuild) {
    app.use(express.static(FRONTEND_DIST));

    // SPA fallback as middleware: Express 5 needs named wildcards ('/*splat') for a route
    app.use((req, res, next) => {
        if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
        res.sendFile(path.join(FRONTEND_DIST, 'index.html'));
    });
}

// --- Start ----------------------------------------------------------------

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`Backend running on port ${PORT}`);
    console.log(`Bridge expected at ${FIVEM_API_URL}`);
    console.log(`[Data] Jobs: ${Object.keys(getJobs()).length}, Items: ${Object.keys(getItems()).length}, Vehicles: ${Object.keys(getVehicles()).length}`);

    if (auth.ENABLED) {
        const summary = auth.mappingSummary();
        const total = summary.reduce((n, r) => n + r.users + r.guildRoles, 0);
        console.log(`[Auth] Discord login active - ${total} mapping(s) configured`);
        console.log(`[Auth] Sessions last ${auth.SESSION_HOURS}h`);
        const mapped = summary
            .map(r => `${r.label}: ${r.users} id(s) / ${r.guildRoles} role(s)`)
            .join(', ');
        console.log(`[Perms] ${mapped}`);
    }

    // Framed so misconfigurations stand out in the log
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

    // txAdmin store details go to the operator here; the portal only says "could not be read"
    require('./utils/txadmin').describe([]).then(tx => {
        if (tx.available) {
            // Portal shows bans only, hence the split; identifier kinds = what a ban can match on
            const s = tx.store;
            console.log(`[txAdmin] Ban record readable - ${s.actions} action(s): ${s.bans} ban(s), ${s.warns} warning(s)`);
            console.log(`          keyed by [${s.identifierKinds.join(', ') || 'nothing'}]`);
            console.log(`          ${tx.path}`);
            if (s.bans === 0) {
                console.log('          Veritas ID shows bans only, so nothing here will appear in it.');
            }
        } else {
            console.log(`[txAdmin] ${tx.reason}`);
            console.log(`          ${tx.hint}`);
            console.log('          Veritas ID will say it could not check, rather than "no bans".');
        }
    }).catch(e => console.log(`[txAdmin] check failed: ${e.message}`));
});
