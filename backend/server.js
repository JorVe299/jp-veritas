require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const { loadGameData, getJobs } = require('./utils/dataLoader');
const { db, parseJSON, updatePlayerColumn } = require('./utils/dbHandler');

const app = express();
app.use(cors());
app.use(express.json());

// FiveM Bridge URL (die jp-veritas Resource auf dem Server)
// Der Pfad hinter dem Port ist der Resource-Name
const FIVEM_API_URL = process.env.FIVEM_API_URL || 'http://127.0.0.1:30120/jp-veritas';

// Beim Start Daten laden
loadGameData();

// --- Bridge Helper -------------------------------------------------------

// Fragt die Bridge, ob ein Spieler gerade online ist.
// Wenn der Server nicht erreichbar ist, behandeln wir ihn als offline
// und gehen automatisch den SQL-Weg.
async function isPlayerOnline(citizenid) {
    try {
        const res = await axios.post(`${FIVEM_API_URL}/check-online`, { citizenid }, { timeout: 2000 });
        return !!res.data.isOnline;
    } catch (e) {
        console.log('[Bridge] Nicht erreichbar (Server offline?) - nutze SQL Fallback');
        return false;
    }
}

// --- Management Routen ---------------------------------------------------

// Route: Geld geben (Hybrid Logik)
app.post('/api/manage/money', async (req, res) => {
    const { citizenid, amount, type } = req.body; // type: 'bank' or 'cash'

    if (!citizenid) return res.status(400).json({ error: 'citizenid fehlt' });

    const moneyType = type === 'cash' ? 'cash' : 'bank';
    const delta = Number(amount);
    if (!Number.isFinite(delta)) return res.status(400).json({ error: 'amount muss eine Zahl sein' });

    try {
        if (await isPlayerOnline(citizenid)) {
            // WEG A: Live Update via Bridge
            const bridgeRes = await axios.post(`${FIVEM_API_URL}/update-money`, {
                citizenid, amount: delta, type: moneyType
            });
            if (!bridgeRes.data.success) {
                return res.status(502).json({ error: bridgeRes.data.msg || 'Bridge Fehler' });
            }
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
        console.error(error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Route: Job setzen (Hybrid Logik)
app.post('/api/manage/job', async (req, res) => {
    const { citizenid, jobName, gradeLevel } = req.body;

    if (!citizenid || !jobName) return res.status(400).json({ error: 'citizenid und jobName sind Pflicht' });

    // Job + Grade gegen die geladenen Spieldaten prüfen,
    // damit kein Fantasie-Job in der DB landet
    const jobs = getJobs();
    const job = jobs[jobName];
    if (!job) return res.status(404).json({ error: `Job '${jobName}' existiert nicht` });

    const level = String(gradeLevel ?? '0');
    const grade = job.grades?.[level];
    if (!grade) return res.status(400).json({ error: `Grade '${level}' existiert für Job '${jobName}' nicht` });

    try {
        if (await isPlayerOnline(citizenid)) {
            // WEG A: Live Update via Bridge (der Core setzt selbst alles korrekt)
            const bridgeRes = await axios.post(`${FIVEM_API_URL}/update-job`, {
                citizenid, jobName, gradeLevel: Number(level)
            });
            if (!bridgeRes.data.success) {
                return res.status(502).json({ error: bridgeRes.data.msg || 'Bridge Fehler' });
            }
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
        console.error(error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// --- Lese-Routen ---------------------------------------------------------

app.get('/api/players', async (req, res) => {
    // Auf Integer zwingen und begrenzen: LIMIT/OFFSET lassen sich nicht
    // zuverlässig als Prepared-Statement-Parameter übergeben, deshalb
    // werden sie hier validiert und direkt eingesetzt
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 100);
    const search = req.query.search || '';
    const offset = (page - 1) * limit;

    try {
        // 1. Hole Online-Liste von der Bridge (für den Status-Indikator)
        // Timeout kurz halten, falls Server offline ist
        let onlineIDs = {};
        try {
            const onlineRes = await axios.get(`${FIVEM_API_URL}/get-online-players`, { timeout: 1000 });
            onlineIDs = onlineRes.data || {};
        } catch (e) {
            console.log('FiveM Bridge nicht erreichbar (Server offline?)');
        }

        // 2. SQL Query bauen (Qbox speichert Namen in charinfo JSON)
        let query;
        let params;

        if (search) {
            // Wir suchen in Vorname, Nachname oder CitizenID
            query = `
                SELECT citizenid, charinfo, job, money
                FROM players
                WHERE
                    citizenid LIKE ? OR
                    JSON_UNQUOTE(JSON_EXTRACT(charinfo, '$.firstname')) LIKE ? OR
                    JSON_UNQUOTE(JSON_EXTRACT(charinfo, '$.lastname')) LIKE ?
                LIMIT ${limit} OFFSET ${offset}
            `;
            const searchTerm = `%${search}%`;
            params = [searchTerm, searchTerm, searchTerm];
        } else {
            query = `SELECT citizenid, charinfo, job, money FROM players LIMIT ${limit} OFFSET ${offset}`;
            params = [];
        }

        const [rows] = await db.execute(query, params);

        // 3. Daten aufbereiten (JSON Strings -> Objekte & Online Check)
        const players = rows.map(row => {
            const char = parseJSON(row.charinfo);
            const job = parseJSON(row.job);
            const money = parseJSON(row.money);

            return {
                citizenid: row.citizenid,
                name: `${char.firstname || '?'} ${char.lastname || ''}`.trim(),
                charinfo: char,
                job: job,
                jobLabel: `${job.label || 'Kein Job'} - ${job.grade?.name || '-'}`,
                money: money, // { cash: x, bank: y }
                isOnline: !!onlineIDs[row.citizenid], // true/false
                sourceID: onlineIDs[row.citizenid] || null
            };
        });

        res.json(players);

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'DB Fehler' });
    }
});

// API Route für das Frontend (React braucht die Listen für Dropdowns)
app.get('/api/meta/jobs', (req, res) => {
    res.json(getJobs());
});

// Route zum Neuladen der JSON-Daten ohne Neustart
app.post('/api/system/refresh', (req, res) => {
    try {
        loadGameData(); // Führt Sync & Load erneut aus
        console.log('[System] Hot-Reload der Spieldaten durchgeführt.');
        res.json({ success: true, message: 'Daten erfolgreich synchronisiert.' });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// --- Start ---------------------------------------------------------------

const PORT = process.env.PORT || 3001; // Backend Port
app.listen(PORT, () => {
    console.log(`Backend running on port ${PORT}`);
    console.log(`Bridge erwartet unter ${FIVEM_API_URL}`);
});
