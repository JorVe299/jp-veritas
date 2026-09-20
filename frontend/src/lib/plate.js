// Deterministische Schlüsselbild-Erzeugung ("plate") pro Citizen.
//
// Der Grund: Die Oberflaeche ist eine Kachelwand, aber Charaktere haben kein
// Bildmaterial. Statt leerer Rechtecke oder eines Avatar-Dienstes wird das
// Motiv aus der CitizenID abgeleitet. Gleiche ID -> gleiches Bild, immer,
// ohne Netzwerk und ohne gespeicherten Zustand. Das Bild ist damit ein
// wiedererkennbares Merkmal des Datensatzes, keine Dekoration.

/** FNV-1a (32 bit). Klein, schnell, gut gestreut fuer kurze Strings. */
function hash32(input) {
    let h = 0x811c9dc5;
    const s = String(input ?? '');
    for (let i = 0; i < s.length; i += 1) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
}

/** Mulberry32: aus einem Seed eine reproduzierbare Zahlenfolge in [0,1). */
function rng(seed) {
    let a = seed >>> 0;
    return function next() {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// Acht Himmel aus dem Los-Santos-Tagesverlauf. Jede Palette ist ein Duoton:
// Zenit -> Horizont, dazu eine Lichtquelle und die Silhouettenfarbe.
// Die Farbe der Oberflaeche steckt bewusst hier drin und nicht im Chrome.
const SKIES = [
    { id: 'dusk', zenith: '#2B1B4D', horizon: '#7B2D6B', light: '#FFB067', land: '#140B22', haze: '#FF8FA3' },
    { id: 'sodium', zenith: '#3A1F0C', horizon: '#B4551A', light: '#FFD08A', land: '#190D05', haze: '#FFA55C' },
    { id: 'palm', zenith: '#06342E', horizon: '#1E8F76', light: '#F2E27A', land: '#04201B', haze: '#8FE3C4' },
    { id: 'smog', zenith: '#3B2430', horizon: '#A3596B', light: '#F6C1B4', land: '#1D1018', haze: '#E9A8AE' },
    { id: 'ocean', zenith: '#08243F', horizon: '#1C6C9E', light: '#CFE9F5', land: '#05172A', haze: '#7FC4E8' },
    { id: 'vinewood', zenith: '#2A0E20', horizon: '#8E2B4B', light: '#FFC26B', land: '#160615', haze: '#FF9BA6' },
    { id: 'chaparral', zenith: '#2E2A10', horizon: '#8A7A22', light: '#FFF0A8', land: '#16130A', haze: '#E4D98A' },
    { id: 'storm', zenith: '#1A2030', horizon: '#4A5C78', light: '#D6DEE8', land: '#0C1018', haze: '#9FB3CC' },
];

// Zwei Zuschnitte: das Hochformat der Kacheln und ein Breitbild fuer den
// Kopfbereich. Das Breitbild wird eigens gebaut, statt das Hochformat zu
// beschneiden - sonst bliebe von der Komposition nur ein Mittelstreifen.
const SHAPES = {
    poster: { w: 200, h: 300 },
    wide: { w: 400, h: 225 },
};

/**
 * Baut eine Hoehenlinie als SVG-Pfad, der unten geschlossen ist.
 * peaks bestimmt die Zackigkeit, baseY die Hoehe am Rand.
 */
function ridgePath(next, peaks, baseY, amplitude, W, H) {
    const step = W / peaks;
    let d = `M0 ${H}L0 ${baseY}`;
    let x = 0;
    let y = baseY;

    for (let i = 0; i < peaks; i += 1) {
        const nx = x + step;
        // Zielhoehe des naechsten Punktes, um baseY herum
        const ny = baseY - amplitude * next() + amplitude * 0.35;
        // Kontrollpunkt in der Mitte erzeugt den weichen Bergruecken
        const cx = x + step / 2;
        const cy = (y + ny) / 2 - amplitude * 0.45 * next();
        d += `Q${cx.toFixed(1)} ${cy.toFixed(1)} ${nx.toFixed(1)} ${ny.toFixed(1)}`;
        x = nx;
        y = ny;
    }

    d += `L${W} ${H}Z`;
    return d;
}

/**
 * Erzeugt die komplette Bildbeschreibung fuer eine CitizenID.
 * Rein rechnerisch, kein DOM, damit es sich testen und memoisieren laesst.
 */
export function buildPlate(citizenid, shape = 'poster') {
    const { w: W, h: H } = SHAPES[shape] ?? SHAPES.poster;
    const seed = hash32(citizenid || 'unknown');
    const next = rng(seed);

    const sky = SKIES[seed % SKIES.length];

    // Ein Fuenftel der Himmel ist bedeckt und hat gar keine Scheibe. Ohne das
    // sieht jedes Bild nach derselben Sonne ueber denselben Huegeln aus.
    const overcast = next() < 0.22;

    // Vier Bautypen statt einem. Mit nur einem las die Wand als ein einziges
    // Bild in acht Farbtoenen - und damit fiel genau die Unterscheidbarkeit
    // weg, wegen der die Bilder ueberhaupt erzeugt werden.
    const ARCHETYPES = ['ridges', 'skyline', 'coast', 'overhead'];
    const archetype = ARCHETYPES[Math.floor(next() * ARCHETYPES.length)];
    const overhead = archetype === 'overhead';

    // Overhead setzt den Horizont hoch: der Boden nimmt fast das ganze Bild
    // ein, die Scheibe steht klein und hoch. Das liest als Mittag statt
    // Daemmerung und bricht die Reihe der Sonnenuntergaenge auf.
    const horizonY = overhead
        ? H * (0.26 + next() * 0.1)
        : H * (0.5 + next() * 0.16);

    // Lichtquelle: nie exakt mittig, nie ganz am Rand, und selten dicht
    // ueber dem Horizont statt immer hoch im Bild.
    const lightLow = !overhead && next() < 0.34;
    const light = {
        x: W * (0.12 + next() * 0.76),
        y: lightLow ? horizonY - H * (0.04 + next() * 0.1) : H * (0.08 + next() * 0.2),
        r: (W * 0.055) * (overhead ? 0.4 + next() * 0.3 : 0.7 + next() * 0.95),
        glow: overhead ? 4.5 + next() * 3 : 2.8 + next() * 3.4,
    };

    const ridgeBack = ridgePath(next, 3 + Math.floor(next() * 3), horizonY, H * 0.15, W, H);
    const ridgeFront = ridgePath(next, 2 + Math.floor(next() * 3), horizonY + H * 0.11, H * 0.115, W, H);

    // Skyline: eine Bebauungskante aus Bloecken auf dem vorderen Ruecken.
    const towers = [];
    if (archetype === 'skyline') {
        const count = 6 + Math.floor(next() * 9);
        let x = -W * 0.04;
        for (let i = 0; i < count && x < W; i += 1) {
            const tw = W * (0.03 + next() * 0.075);
            const th = H * (0.04 + next() * 0.2);
            towers.push({ x, w: tw, h: th, y: horizonY + H * 0.06 - th });
            x += tw + W * (0.004 + next() * 0.022);
        }
    }

    // Coast: eine Wasserflaeche unter dem Horizont mit einer Lichtspur.
    const coast = archetype === 'coast'
        ? {
            y: horizonY + H * (0.06 + next() * 0.08),
            glints: Array.from({ length: 5 + Math.floor(next() * 6) }, () => ({
                y: next(),
                w: W * (0.05 + next() * 0.3),
                o: 0.08 + next() * 0.2,
            })),
        }
        : null;

    // Palmen stehen auf dem vorderen Ruecken. Null ist ein gueltiges Ergebnis:
    // nicht jedes Bild braucht sie, das erhoeht die Varianz der Wand.
    const palmCount = Math.floor(next() * 4);
    const palms = [];
    for (let i = 0; i < palmCount; i += 1) {
        palms.push({
            x: W * (0.08 + next() * 0.84),
            y: horizonY + H * (0.1 + next() * 0.16),
            scale: (W / 200) * (0.5 + next() * 0.7),
            flip: next() > 0.5,
        });
    }

    // Dunstbaender ueber dem Horizont. Bewusst duenn und blass: sie sollen
    // als Schichtung im Licht lesen, nicht als Balken auf der Flaeche.
    const bands = [];
    const bandCount = 2 + Math.floor(next() * 4);
    for (let i = 0; i < bandCount; i += 1) {
        bands.push({
            y: horizonY - H * (0.02 + next() * 0.2),
            h: H * (0.008 + next() * 0.016),
            x: -W * 0.05 + next() * W * 0.35,
            w: W * (0.4 + next() * 0.7),
            o: (0.06 + next() * 0.12) * (shape === 'wide' ? 0.7 : 1),
        });
    }

    return {
        id: `p${seed.toString(36)}-${shape}`,
        sky,
        overcast,
        archetype,
        light,
        horizonY,
        ridgeBack,
        ridgeFront,
        towers,
        coast,
        overhead,
        palms,
        bands,
        width: W,
        height: H,
        viewBox: `0 0 ${W} ${H}`,
    };
}

// Die Wand rendert dieselben Citizens beim Blaettern und Tippen mehrfach neu.
// Ein kleiner Cache verhindert, dass die Geometrie jedes Mal neu faellt.
const cache = new Map();
const CACHE_LIMIT = 300;

export function getPlate(citizenid, shape = 'poster') {
    const key = `${citizenid || 'unknown'}::${shape}`;
    const hit = cache.get(key);
    if (hit) return hit;

    const plate = buildPlate(citizenid, shape);
    if (cache.size >= CACHE_LIMIT) {
        cache.delete(cache.keys().next().value);
    }
    cache.set(key, plate);
    return plate;
}
