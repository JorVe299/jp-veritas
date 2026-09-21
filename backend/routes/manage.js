// backend/routes/manage.js
// Money and job - the two hybrid routes: live through the bridge while the
// player is online, straight into the database when they are not.
const express = require('express');
const { db, parseJSON, updatePlayerColumn } = require('../utils/dbHandler');
const { getJobs } = require('../utils/dataLoader');
const { isPlayerOnline, callBridge } = require('../utils/bridge');

const router = express.Router();

// --- Money ----------------------------------------------------------------
router.post('/api/manage/money', async (req, res) => {
    const { citizenid, amount, type } = req.body; // type: 'bank' or 'cash'

    if (!citizenid) return res.status(400).json({ error: 'citizenid is missing' });

    const moneyType = type === 'cash' ? 'cash' : 'bank';
    const delta = Number(amount);
    if (!Number.isFinite(delta)) return res.status(400).json({ error: 'amount must be a number' });

    try {
        if (await isPlayerOnline(citizenid)) {
            // PATH A: live update through the bridge
            await callBridge('/update-money', { citizenid, amount: delta, type: moneyType });
            return res.json({ status: 'success', mode: 'live', message: 'Money updated via Live API' });
        }

        // PATH B: SQL update
        // Qbox stores money as JSON in 'players' -> 'money'
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

    // Check job and grade against the loaded game data so that no
    // made-up job ends up in the database
    const jobs = getJobs();
    const job = jobs[jobName];
    if (!job) return res.status(404).json({ error: `Job '${jobName}' does not exist` });

    const level = String(gradeLevel ?? '0');
    const grade = job.grades?.[level];
    if (!grade) return res.status(400).json({ error: `Grade '${level}' does not exist for job '${jobName}'` });

    try {
        if (await isPlayerOnline(citizenid)) {
            // PATH A: live update through the bridge (the core sets everything up correctly itself)
            await callBridge('/update-job', { citizenid, jobName, gradeLevel: Number(level) });
            return res.json({ status: 'success', mode: 'live', message: 'Job updated via Live API' });
        }

        // PATH B: SQL update - we rebuild the job structure from the shared jobs
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
