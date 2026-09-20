// backend/utils/dbHandler.js
const mysql = require('mysql2/promise');

// Zentraler DB Pool - alle DB Zugriffe laufen über dieses Modul
const db = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10
});

// Whitelist: Spaltennamen können nicht als Prepared-Statement-Parameter
// übergeben werden, deshalb hier gegen eine feste Liste prüfen
const ALLOWED_COLUMNS = [
    'citizenid', 'charinfo', 'money', 'job', 'gang',
    'inventory', 'metadata', 'position', 'license', 'name', 'phone_number'
];

// Hilfsfunktion: JSON parsen wenn nötig (MySQL liefert JSON-Spalten
// je nach Treiber/Version mal als String, mal als Objekt)
function parseJSON(data) {
    if (typeof data === 'string') {
        try { return JSON.parse(data); } catch { return {}; }
    }
    return data || {};
}

// Hilfsfunktion: Lädt Spielerdaten sicher
async function getPlayerData(citizenid, columns = ['money', 'charinfo', 'inventory']) {
    const safeColumns = columns.filter(c => ALLOWED_COLUMNS.includes(c));
    if (safeColumns.length === 0) throw new Error('No valid columns requested');

    const query = `SELECT ${safeColumns.join(',')} FROM players WHERE citizenid = ?`;
    const [rows] = await db.execute(query, [citizenid]);

    if (rows.length === 0) return null;

    // Automatisch alle JSON-Spalten parsen
    const data = rows[0];
    for (const key in data) {
        if (typeof data[key] === 'string' && (data[key].startsWith('{') || data[key].startsWith('['))) {
            try {
                data[key] = JSON.parse(data[key]);
            } catch (e) {
                console.error(`JSON Parse Error bei ${key}:`, e.message);
            }
        }
    }
    return data;
}

// Schreibt eine einzelne JSON-Spalte eines Spielers zurück
async function updatePlayerColumn(citizenid, column, value) {
    if (!ALLOWED_COLUMNS.includes(column)) throw new Error(`Column ${column} is not allowed`);

    const payload = typeof value === 'string' ? value : JSON.stringify(value);
    const [result] = await db.execute(
        `UPDATE players SET ${column} = ? WHERE citizenid = ?`,
        [payload, citizenid]
    );
    return result.affectedRows > 0;
}

// --- Schema-Introspektion ------------------------------------------------
// Qbox, QBCore und die diversen Inventar-Resources benennen ihre Spalten
// unterschiedlich. Statt eine Variante fest zu verdrahten, fragen wir die
// Datenbank einmal, was tatsächlich da ist, und bauen die Queries danach.

const schemaCache = new Map();

async function getTableColumns(table) {
    if (schemaCache.has(table)) return schemaCache.get(table);

    const [rows] = await db.execute(
        `SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
        [table]
    );

    const columns = rows.map(r => r.name);
    schemaCache.set(table, columns);
    return columns;
}

async function tableExists(table) {
    return (await getTableColumns(table)).length > 0;
}

// Reduziert ein Objekt auf die Felder, die es in der Tabelle wirklich gibt.
// So kippt ein INSERT nicht, nur weil diese Qbox-Version eine Spalte
// weniger hat als die, gegen die entwickelt wurde.
async function pickExistingColumns(table, data) {
    const columns = await getTableColumns(table);
    const out = {};
    for (const [key, value] of Object.entries(data)) {
        if (columns.includes(key)) out[key] = value;
    }
    return out;
}

function clearSchemaCache() {
    schemaCache.clear();
}

module.exports = {
    db, parseJSON, getPlayerData, updatePlayerColumn,
    getTableColumns, tableExists, pickExistingColumns, clearSchemaCache
};
