// backend/routes/meta.js
// Stammdaten für die Dropdowns im Frontend: Jobs, Items, Fahrzeuge.
// Quelle ist der Cache aus dataLoader, der beim Start aus den JSON-Dateien
// der FiveM Resource befüllt wird.
const express = require('express');
const { getJobs, getItems, getVehicles } = require('../utils/dataLoader');

const router = express.Router();

// Items und Fahrzeuge sind mehrere hundert Einträge. Für eine Auswahlliste
// mit Texteingabe reicht eine gefilterte Teilmenge - das hält die Antwort
// klein und die Eingabe flüssig.
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

// Jobs sind überschaubar (Größenordnung 20) - die gehen komplett raus,
// das Frontend baut daraus verschachtelte Job/Rang-Dropdowns.
router.get('/api/meta/jobs', (req, res) => {
    res.json(getJobs());
});

router.get('/api/meta/items', (req, res) => {
    res.json(searchCatalog(getItems(), req.query));
});

router.get('/api/meta/vehicles', (req, res) => {
    res.json(searchCatalog(getVehicles(), req.query));
});

// Überblick, was überhaupt geladen ist. Zeigt sofort, ob die FiveM Resource
// ihre JSON-Dateien schon geschrieben hat.
router.get('/api/meta/summary', (req, res) => {
    res.json({
        jobs: Object.keys(getJobs()).length,
        items: Object.keys(getItems()).length,
        vehicles: Object.keys(getVehicles()).length
    });
});

module.exports = { router };
