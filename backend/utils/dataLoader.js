const fs = require('fs');
const path = require('path');

// Ziel: Der lokale data Ordner im Backend
const LOCAL_DATA_PATH = path.join(__dirname, '../data');

// Quelle: Der Pfad aus der .env
const FIVEM_SOURCE_PATH = process.env.FIVEM_JSON_PATH;

const FILES = ['jobs.json', 'items.json', 'vehicles.json'];
const CACHE = { jobs: {}, items: {}, vehicles: {} };

function syncAndLoadData() {
    // 1. Versuche Daten vom FiveM Server zu kopieren (Sync)
    if (FIVEM_SOURCE_PATH && fs.existsSync(FIVEM_SOURCE_PATH)) {
        console.log('[Data] Checking for FiveM updates...');
        
        FILES.forEach(file => {
            try {
                const sourceFile = path.join(FIVEM_SOURCE_PATH, file);
                const destFile = path.join(LOCAL_DATA_PATH, file);

                if (fs.existsSync(sourceFile)) {
                    // Kopiere Datei von FiveM -> Backend
                    fs.copyFileSync(sourceFile, destFile);
                    console.log(`   -> Synced ${file}`);
                }
            } catch (err) {
                console.warn(`   -> Could not sync ${file}:`, err.message);
            }
        });
    } else {
        console.log('[Data] No FIVEM_JSON_PATH defined or path invalid. Using local cache only.');
    }

    // 2. Lade Daten aus dem lokalen Cache (Backend Ordner)
    // Wichtig: try/catch pro Datei - sonst reisst eine kaputte Datei
    // alle anderen mit und der Cache bleibt komplett leer
    FILES.forEach(file => {
        const key = file.replace('.json', ''); // jobs.json -> jobs
        const filePath = path.join(LOCAL_DATA_PATH, file);

        try {
            if (!fs.existsSync(filePath)) {
                console.warn(`[Data] Warning: ${file} not found in backend/data/`);
                return;
            }

            const raw = fs.readFileSync(filePath, 'utf8');
            if (!raw.trim()) {
                console.warn(`[Data] Warning: ${file} ist leer. Starte die jp-veritas Resource auf dem FiveM Server, um sie zu erzeugen.`);
                return;
            }

            CACHE[key] = JSON.parse(raw);
        } catch (e) {
            console.error(`[Data] Error parsing ${file}:`, e.message);
        }
    });

    console.log(`[Data] Loaded. Jobs: ${Object.keys(CACHE.jobs).length}, Items: ${Object.keys(CACHE.items).length}, Vehicles: ${Object.keys(CACHE.vehicles).length}`);
}

// Initialer Start
if (!fs.existsSync(LOCAL_DATA_PATH)){
    fs.mkdirSync(LOCAL_DATA_PATH);
}

module.exports = { 
    loadGameData: syncAndLoadData, 
    getJobs: () => CACHE.jobs, 
    getItems: () => CACHE.items, 
    getVehicles: () => CACHE.vehicles 
};