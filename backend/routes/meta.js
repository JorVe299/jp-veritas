// Reference data for the dropdowns (jobs, gangs, items, vehicles) from the dataLoader cache
const express = require('express');
const { getJobs, getItems, getVehicles, getGangs } = require('../utils/dataLoader');

const router = express.Router();

// Items and vehicles: hundreds of entries; pickers get a filtered subset
function searchCatalog(catalog, { search, limit }) {
    const term = String(search || '').toLowerCase().trim();
    const max = Math.min(Math.max(parseInt(limit) || 50, 1), 500);

    const entries = Object.entries(catalog);
    const matched = term
        ? entries.filter(([key, value]) => {
            const label = String(value?.label || value?.name || '').toLowerCase();
            const brand = String(value?.brand || '').toLowerCase();
            return key.toLowerCase().includes(term) || label.includes(term) || brand.includes(term);
        })
        : entries;

    return {
        total: entries.length,
        matched: matched.length,
        truncated: matched.length > max,
        results: matched.slice(0, max).map(([key, value]) => ({ key, ...value }))
    };
}

// Jobs: small set, sent in full for the nested job/grade dropdowns
router.get('/api/meta/jobs', (req, res) => {
    res.json(getJobs());
});

// Gangs: small set, sent in full
router.get('/api/meta/gangs', (req, res) => {
    res.json(getGangs());
});

router.get('/api/meta/items', (req, res) => {
    res.json(searchCatalog(getItems(), req.query));
});

router.get('/api/meta/vehicles', (req, res) => {
    res.json(searchCatalog(getVehicles(), req.query));
});

// Counts per catalog: shows whether the resource has written its JSON files yet
router.get('/api/meta/summary', (req, res) => {
    res.json({
        jobs: Object.keys(getJobs()).length,
        gangs: Object.keys(getGangs()).length,
        items: Object.keys(getItems()).length,
        vehicles: Object.keys(getVehicles()).length
    });
});

module.exports = { router };
