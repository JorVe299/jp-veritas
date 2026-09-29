// MySQL pool and schema introspection
const mysql = require('mysql2/promise');

// Single pool; all DB access goes through this module
const db = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10
});

// Column names cannot be bound as parameters: allowlist
const ALLOWED_COLUMNS = [
    'citizenid', 'charinfo', 'money', 'job', 'gang',
    'inventory', 'metadata', 'position', 'license', 'name', 'phone_number'
];

// JSON columns arrive as string or object, depending on driver and version
function parseJSON(data) {
    if (typeof data === 'string') {
        try { return JSON.parse(data); } catch { return {}; }
    }
    return data || {};
}

// Writes one allowlisted players column
async function updatePlayerColumn(citizenid, column, value) {
    if (!ALLOWED_COLUMNS.includes(column)) throw new Error(`Column ${column} is not allowed`);

    const payload = typeof value === 'string' ? value : JSON.stringify(value);
    const [result] = await db.execute(
        `UPDATE players SET ${column} = ? WHERE citizenid = ?`,
        [payload, citizenid]
    );
    return result.affectedRows > 0;
}

// --- Schema introspection -------------------------------------------------
// Column names differ across Qbox, QBCore and inventories: discovered once, then cached

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

// Drops fields the table lacks: an INSERT survives schema version differences
async function pickExistingColumns(table, data) {
    const columns = await getTableColumns(table);
    const out = {};
    for (const [key, value] of Object.entries(data)) {
        if (columns.includes(key)) out[key] = value;
    }
    return out;
}

// Diagnostics only: shows which modules this schema could support
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
    db, parseJSON, updatePlayerColumn,
    getTableColumns, tableExists, pickExistingColumns, clearSchemaCache, listTables
};
