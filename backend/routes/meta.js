// backend/routes/meta.js
// Reference data for the dropdowns in the frontend: jobs, items, vehicles.
// The source is the dataLoader cache, filled at startup from the JSON files
// of the FiveM resource.
const express = require('express');
const { getJobs, getItems, getVehicles, getGangs } = require('../utils/dataLoader');

const router = express.Router();

// Items and vehicles run into the hundreds. For a picker with a text field
// a filtered subset is enough - it keeps the response small and typing
// responsive.
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

// Jobs are manageable (order of twenty) - they go out in full, and the
// frontend builds nested job/grade dropdowns from them.
router.get('/api/meta/jobs', (req, res) => {
    res.json(getJobs());
});

// Gangs are as manageable as jobs and go out in full too.
router.get('/api/meta/gangs', (req, res) => {
    res.json(getGangs());
});

router.get('/api/meta/items', (req, res) => {
    res.json(searchCatalog(getItems(), req.query));
});

router.get('/api/meta/vehicles', (req, res) => {
    res.json(searchCatalog(getVehicles(), req.query));
});

// An overview of what is loaded at all. Shows at a glance whether the FiveM
// resource has written its JSON files yet.
router.get('/api/meta/summary', (req, res) => {
    res.json({
        jobs: Object.keys(getJobs()).length,
        gangs: Object.keys(getGangs()).length,
        items: Object.keys(getItems()).length,
        vehicles: Object.keys(getVehicles()).length
    });
});

module.exports = { router };
