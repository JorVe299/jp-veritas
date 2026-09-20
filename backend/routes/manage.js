// backend/routes/manage.js
// Geld und Job - die beiden Hybrid-Routen: online über die Bridge,
// offline direkt in der Datenbank.
const express = require('express');
const { db, parseJSON, updatePlayerColumn } = require('../utils/dbHandler');
const { getJobs } = require('../utils/dataLoader');
const { isPlayerOnline, callBridge } = require('../utils/bridge');

const router = express.Router();

// --- Geld -----------------------------------------------------------------
router.post('/api/manage/money', async (req, res) => {
    const { citizenid, amount, type } = req.body; // type: 'bank' or 'cash'

    if (!citizenid) return res.status(400).json({ error: 'citizenid is missing' });

    const moneyType = type === 'cash' ? 'cash' : 'bank';
    const delta = Number(amount);
    if (!Number.isFinite(delta)) return res.status(400).json({ error: 'amount must be a number' });

    try {
        if (await isPlayerOnline(citizenid)) {
            // WEG A: Live Update via Bridge
            await callBridge('/update-money', { citizenid, amount: delta, type: moneyType });
            return res.json({ status: 'success', mode: 'live', message: 'Money updated via Live API' });
        }

        // WEG B: SQL Update
        // Qbox speichert Geld als JSON in 'players' -> 'money'
        const [rows] = await db.execute('SELECT money FROM players WHERE citizenid = ?', [citizenid]);
        if (rows.length === 0) return res.status(404).json({ error: 'Player not found' });

        const moneyData = parseJSON(rows[0].money);
        moneyData[moneyType] = (moneyData[moneyType] || 0) + delta;

        await updatePlayerColumn(citizenid, 'money', moneyData);
        return res.json({ status: 'success', mode: 'offline', message: 'Money updated via SQL', money: moneyData });

    } catch (error) {
        if (error.bridgeRejected) return res.status(502).json({ error: error.message });
        console.error('[Manage] money failed:', error.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// --- Job ------------------------------------------------------------------
router.post('/api/manage/job', async (req, res) => {
    const { citizenid, jobName, gradeLevel } = req.body;

    if (!citizenid || !jobName) return res.status(400).json({ error: 'citizenid and jobName are required' });

    // Job + Grade gegen die geladenen Spieldaten prüfen,
    // damit kein Fantasie-Job in der DB landet
    const jobs = getJobs();
    const job = jobs[jobName];
    if (!job) return res.status(404).json({ error: `Job '${jobName}' does not exist` });

    const level = String(gradeLevel ?? '0');
    const grade = job.grades?.[level];
    if (!grade) return res.status(400).json({ error: `Grade '${level}' does not exist for job '${jobName}'` });

    try {
        if (await isPlayerOnline(citizenid)) {
            // WEG A: Live Update via Bridge (der Core setzt selbst alles korrekt)
            await callBridge('/update-job', { citizenid, jobName, gradeLevel: Number(level) });
            return res.json({ status: 'success', mode: 'live', message: 'Job updated via Live API' });
        }

        // WEG B: SQL Update - wir bauen die job-Struktur aus den Shared Jobs nach
        const jobData = {
            name: jobName,
            label: job.label,
            payment: grade.payment || 0,
            onduty: job.defaultDuty ?? true,
            isboss: grade.isboss ?? false,
            type: job.type || 'none',
            grade: {
                name: grade.name,
                level: Number(level)
            }
        };

        const updated = await updatePlayerColumn(citizenid, 'job', jobData);
        if (!updated) return res.status(404).json({ error: 'Player not found' });

        return res.json({ status: 'success', mode: 'offline', message: 'Job updated via SQL', job: jobData });

    } catch (error) {
        if (error.bridgeRejected) return res.status(502).json({ error: error.message });
        console.error('[Manage] job failed:', error.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

module.exports = { router };
