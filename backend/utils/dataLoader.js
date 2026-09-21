const fs = require('fs');
const path = require('path');

// Target: the local data folder inside the backend
const LOCAL_DATA_PATH = path.join(__dirname, '../data');

// Source: the path from .env
const FIVEM_SOURCE_PATH = process.env.FIVEM_JSON_PATH;

const FILES = ['jobs.json', 'items.json', 'vehicles.json', 'gangs.json'];
const CACHE = { jobs: {}, items: {}, vehicles: {}, gangs: {} };

function syncAndLoadData() {
    // 1. Try to copy the data from the FiveM server (sync)
    if (FIVEM_SOURCE_PATH && fs.existsSync(FIVEM_SOURCE_PATH)) {
        console.log('[Data] Checking for FiveM updates...');
        
        FILES.forEach(file => {
            try {
                const sourceFile = path.join(FIVEM_SOURCE_PATH, file);
                const destFile = path.join(LOCAL_DATA_PATH, file);

                if (fs.existsSync(sourceFile)) {
                    // Copy the file from FiveM -> backend
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

    // 2. Load the data from the local cache (backend folder)
    // Important: try/catch per file - otherwise one broken file takes all
    // the others down with it and the cache stays completely empty
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
                console.warn(`[Data] Warning: ${file} is empty. Start the veritas resource on the FiveM server to generate it.`);
                return;
            }

            CACHE[key] = JSON.parse(raw);
        } catch (e) {
            console.error(`[Data] Error parsing ${file}:`, e.message);
        }
    });

    console.log(`[Data] Loaded. Jobs: ${Object.keys(CACHE.jobs).length}, Gangs: ${Object.keys(CACHE.gangs).length}, Items: ${Object.keys(CACHE.items).length}, Vehicles: ${Object.keys(CACHE.vehicles).length}`);
}

// Initial start
if (!fs.existsSync(LOCAL_DATA_PATH)){
    fs.mkdirSync(LOCAL_DATA_PATH);
}

module.exports = { 
    loadGameData: syncAndLoadData, 
    getJobs: () => CACHE.jobs, 
    getItems: () => CACHE.items, 
    getVehicles: () => CACHE.vehicles,
    getGangs: () => CACHE.gangs
};