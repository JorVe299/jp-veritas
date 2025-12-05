const fs = require('fs');
const path = require('path');

// Cache Variable
const CACHE = {
    jobs: {},
    items: {},
    vehicles: {}
};

function loadGameData() {
    try {
        const dataPath = path.join(__dirname, '../data');

        // Lese JSONs
        const jobsRaw = fs.readFileSync(path.join(dataPath, 'jobs.json'), 'utf8');
        const itemsRaw = fs.readFileSync(path.join(dataPath, 'items.json'), 'utf8');
        const vehRaw = fs.readFileSync(path.join(dataPath, 'vehicles.json'), 'utf8');

        CACHE.jobs = JSON.parse(jobsRaw);
        CACHE.items = JSON.parse(itemsRaw);
        CACHE.vehicles = JSON.parse(vehRaw);

        console.log(`[Data] Loaded ${Object.keys(CACHE.items).length} items, ${Object.keys(CACHE.jobs).length} jobs.`);
    } catch (e) {
        console.error('[Data] Error loading game json files. Run /refreshwebdata on server first.', e.message);
    }
}

// Getter
const getJobs = () => CACHE.jobs;
const getItems = () => CACHE.items;
const getVehicles = () => CACHE.vehicles;

module.exports = { loadGameData, getJobs, getItems, getVehicles };