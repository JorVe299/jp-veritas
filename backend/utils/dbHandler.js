// backend/utils/dbHandler.js
const mysql = require('mysql2/promise');

// Central DB pool - every database access goes through this module
const db = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10
});

// Whitelist: column names cannot be passed as prepared-statement
// parameters, so they are checked against a fixed list here
const ALLOWED_COLUMNS = [
    'citizenid', 'charinfo', 'money', 'job', 'gang',
    'inventory', 'metadata', 'position', 'license', 'name', 'phone_number'
];

// Helper: parse JSON when needed (depending on driver and version MySQL
// returns JSON columns sometimes as a string, sometimes as an object)
function parseJSON(data) {
    if (typeof data === 'string') {
        try { return JSON.parse(data); } catch { return {}; }
    }
    return data || {};
}

// Helper: loads player data safely
async function getPlayerData(citizenid, columns = ['money', 'charinfo', 'inventory']) {
    const safeColumns = columns.filter(c => ALLOWED_COLUMNS.includes(c));
    if (safeColumns.length === 0) throw new Error('No valid columns requested');

    const query = `SELECT ${safeColumns.join(',')} FROM players WHERE citizenid = ?`;
    const [rows] = await db.execute(query, [citizenid]);

    if (rows.length === 0) return null;

    // Parse every JSON column automatically
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

// Writes a single JSON column of a player back
async function updatePlayerColumn(citizenid, column, value) {
    if (!ALLOWED_COLUMNS.includes(column)) throw new Error(`Column ${column} is not allowed`);

    const payload = typeof value === 'string' ? value : JSON.stringify(value);
    const [result] = await db.execute(
        `UPDATE players SET ${column} = ? WHERE citizenid = ?`,
        [payload, citizenid]
    );
    return result.affectedRows > 0;
}

// --- Schema introspection ------------------------------------------------
// Qbox, QBCore and the various inventory resources name their columns
// differently. Rather than hard-wiring one variant, we ask the database
// once what is actually there and build the queries from that.

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

// Reduces an object to the fields the table actually has.
// That way an INSERT does not fail just because this Qbox version has one
// column fewer than the one it was developed against.
async function pickExistingColumns(table, data) {
    const columns = await getTableColumns(table);
    const out = {};
    for (const [key, value] of Object.entries(data)) {
        if (columns.includes(key)) out[key] = value;
    }
    return out;
}

// Every table in the database. Diagnostics only: it shows which further
// modules this schema could support at all.
async function listTables() {
    const [rows] = await db.execute(
        `SELECT TABLE_NAME AS name, TABLE_ROWS AS approxRows
         FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = DATABASE()
         ORDER BY TABLE_NAME`
    );
    return rows.map(r => ({ name: r.name, approxRows: Number(r.approxRows) || 0 }));
}

function clearSchemaCache() {
    schemaCache.clear();
}

module.exports = {
    db, parseJSON, getPlayerData, updatePlayerColumn,
    getTableColumns, tableExists, pickExistingColumns, clearSchemaCache, listTables
};
