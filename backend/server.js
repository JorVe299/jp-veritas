require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// DB Pool
const db = mysql.createPool({
    host: process.env.DB_HOST, // 'localhost'
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME // Deine Qbox DB
});

// FiveM Bridge URL (Resource auf dem Server)
// FiveM's integrierter Webserver läuft meist auf Port 30120 + Resource Name
const FIVEM_API_URL = 'http://127.0.0.1:30120/deine-bridge-resource'; 

// Route: Geld geben (Hybrid Logik)
app.post('/api/manage/money', async (req, res) => {
    const { citizenid, amount, type } = req.body; // type: 'bank' or 'cash'

    try {
        // 1. Check: Ist er online?
        // Hinweis: Authentifizierungstoken für die Bridge hier einfügen
        const onlineCheck = await axios.post(`${FIVEM_API_URL}/check-online`, { citizenid });
        
        if (onlineCheck.data.isOnline) {
            // WEG A: Live Update via Bridge
            await axios.post(`${FIVEM_API_URL}/update-money`, { citizenid, amount });
            return res.json({ status: 'success', mode: 'live', message: 'Money updated via Live API' });
        } else {
            // WEG B: SQL Update
            // Qbox speichert Geld oft als JSON in 'players' -> 'money'
            // Das ist tricky mit SQL allein, wir holen erst den String
            const [rows] = await db.execute('SELECT money FROM players WHERE citizenid = ?', [citizenid]);
            if (rows.length === 0) return res.status(404).json({ error: 'Player not found' });

            let moneyData = JSON.parse(rows[0].money);
            moneyData[type] = (moneyData[type] || 0) + amount;

            await db.execute('UPDATE players SET money = ? WHERE citizenid = ?', [JSON.stringify(moneyData), citizenid]);
            return res.json({ status: 'success', mode: 'offline', message: 'Money updated via SQL' });
        }

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

const PORT = process.env.PORT || 3001; // Backend Port
app.listen(PORT, () => {
    console.log(`Backend running on port ${PORT}`);
});

const { loadGameData } = require('./utils/dataLoader');

// Beim Start Daten laden
loadGameData();

// API Route für das Frontend (React braucht die Listen für Dropdowns)
app.get('/api/meta/jobs', (req, res) => {
    const { getJobs } = require('./utils/dataLoader');
    res.json(getJobs());
});