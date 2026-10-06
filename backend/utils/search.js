// Forgiving free-text search: case-blind, any whitespace splits words, word order free
// "john doe", "DOE  john" and "johndoe" all find John Doe

// More words narrow nothing useful and only lengthen the SQL
const MAX_TERMS = 6;

/** Lower-cased words of a query; [] for an empty one */
function terms(raw) {
    const words = String(raw ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    return [...new Set(words)].slice(0, MAX_TERMS);
}

/** Every word in some field, or the spaceless query inside the spaceless fields ("johndoe") */
function matches(fields, words) {
    if (words.length === 0) return true;
    const hay = fields.filter(f => f !== null && f !== undefined && f !== '')
        .map(f => String(f).toLowerCase()).join(' ');
    if (words.every(w => hay.includes(w))) return true;
    return hay.replace(/\s+/g, '').includes(words.join(''));
}

// LIKE treats % and _ as wildcards: typed ones are meant literally
function likeTerm(word) {
    return `%${word.replace(/[\\%_]/g, c => `\\${c}`)}%`;
}

/**
 * SQL twin of matches(); columns are trusted SQL expressions, words go in as parameters
 * joined: expressions concatenated without separator for the spaceless match
 */
function sqlMatch(columns, words, joined = columns) {
    if (words.length === 0) return { sql: '1=1', params: [] };

    const lowered = columns.map(c => `LOWER(${c})`);
    const each = words.map(() => `(${lowered.map(c => `${c} LIKE ?`).join(' OR ')})`);
    const params = words.flatMap(w => lowered.map(() => likeTerm(w)));
    let sql = `(${each.join(' AND ')})`;

    sql += ` OR LOWER(REPLACE(CONCAT_WS('', ${joined.join(', ')}), ' ', '')) LIKE ?`;
    params.push(likeTerm(words.join('')));
    return { sql: `(${sql})`, params };
}

module.exports = { terms, matches, sqlMatch, likeTerm, MAX_TERMS };
