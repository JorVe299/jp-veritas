require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { loadGameData, getJobs, getItems, getVehicles } = require('./utils/dataLoader');
const { FIVEM_API_URL } = require('./utils/bridge');
const auth = require('./utils/auth');

const app = express();

// credentials: true ist noetig, damit der Browser das Sitzungscookie im
// Dev-Betrieb mitschickt. Die Origin wird eng gefasst - '*' waere mit
// Cookies ohnehin unzulaessig.
app.use(cors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
    credentials: true
}));
app.use(express.json());
app.use(cookieParser());

// Beim Start Daten laden (muss vor den Routen passieren, die den Cache lesen)
loadGameData();

// --- Anmeldung ------------------------------------------------------------
// Die Auth-Routen stehen bewusst vor der Middleware: sie muessen auch ohne
// Sitzung erreichbar sein.
app.use(require('./routes/auth').router);
app.use(auth.requireAuth);

// --- Routen ---------------------------------------------------------------
// Alles ab hier setzt eine gueltige Sitzung voraus, sofern Discord-Auth
// konfiguriert ist. Jedes Modul bringt seine eigenen vollstaendigen
// /api/... Pfade mit, damit man in der Datei sieht, welche URL es bedient.
app.use(require('./routes/players').router);      // Spielerliste, Einzelabruf
app.use(require('./routes/manage').router);       // Geld, Job
app.use(require('./routes/vehicles').router);     // Fahrzeuge
app.use(require('./routes/inventory').router);    // Inventar
app.use(require('./routes/playerdata').router);   // Lizenzen, Status, Charakterdaten
app.use(require('./routes/meta').router);         // Stammdaten für Dropdowns
app.use(require('./routes/system').router);       // Diagnose, Schema, Refresh

// --- Frontend ausliefern --------------------------------------------------
// Nach `npm run build` im frontend/ liegt dort dist/. Express serviert das mit,
// dann laufen Panel und API über denselben Port: die relativen /api Pfade
// funktionieren ohne Proxy, und es gibt nur einen Port abzusichern.
// Muss nach den API-Routen stehen, damit nichts überschattet wird.
const FRONTEND_DIST = path.join(__dirname, '../frontend/dist');
const hasFrontendBuild = fs.existsSync(path.join(FRONTEND_DIST, 'index.html'));

if (hasFrontendBuild) {
    app.use(express.static(FRONTEND_DIST));

    // SPA Fallback: alles was keine API-Route ist, bekommt die index.html.
    // Bewusst als Middleware statt Wildcard-Route - Express 5 verlangt
    // benannte Wildcards ('/*splat'), das hier ist versionsunabhängig.
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
        const gate = [];
        if (auth.ADMIN_IDS.length) gate.push(`${auth.ADMIN_IDS.length} user id(s)`);
        if (auth.ADMIN_ROLE_IDS.length) gate.push(`${auth.ADMIN_ROLE_IDS.length} role(s) in guild ${auth.GUILD_ID}`);
        console.log(`[Auth] Discord login active - access via ${gate.join(' or ') || 'nothing configured'}`);
        console.log(`[Auth] Sessions last ${auth.SESSION_HOURS}h`);
    }

    // Fehlkonfigurationen duerfen nicht in der Logflut untergehen: eine
    // offene /api/manage/money Route ist kein Detail.
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
});
