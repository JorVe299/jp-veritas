// backend/utils/dbHandler.js

// Hilfsfunktion: Lädt Spielerdaten sicher
async function getPlayerData(citizenid, columns = ['money', 'charinfo', 'inventory']) {
    const query = `SELECT ${columns.join(',')} FROM players WHERE citizenid = ?`;
    const [rows] = await db.execute(query, [citizenid]);
    
    if (rows.length === 0) return null;

    // Automatisch alle JSON-Spalten parsen
    const data = rows[0];
    for (const key in data) {
        if (typeof data[key] === 'string' && (data[key].startsWith('{') || data[key].startsWith('['))) {
            try {
                data[key] = JSON.parse(data[key]);
            } catch (e) {
                console.error(`JSON Parse Error bei ${key}:`, e);
            }
        }
    }
    return data;
}