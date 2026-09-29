// Deterministic key image ("plate") per CitizenID: characters have no pictures
// Same ID -> same image, no network, no stored state: a recognisable trait, not decoration

// FNV-1a, 32 bit: well spread for short strings
function hash32(input) {
    let h = 0x811c9dc5;
    const s = String(input ?? '');
    for (let i = 0; i < s.length; i += 1) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
}

// Mulberry32: reproducible [0,1) sequence from one seed
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

// Duotone zenith -> horizon plus light and silhouette; the UI's color lives here, not in chrome
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

// wide is composed on its own: cropping the poster would keep only a middle strip
const SHAPES = {
    poster: { w: 200, h: 300 },
    wide: { w: 400, h: 225 },
};

// SVG path closed at the bottom; peaks: jaggedness, baseY: height at the edge
function ridgePath(next, peaks, baseY, amplitude, W, H) {
    const step = W / peaks;
    let d = `M0 ${H}L0 ${baseY}`;
    let x = 0;
    let y = baseY;

    for (let i = 0; i < peaks; i += 1) {
        const nx = x + step;
        const ny = baseY - amplitude * next() + amplitude * 0.35;
        const cx = x + step / 2;
        const cy = (y + ny) / 2 - amplitude * 0.45 * next();
        d += `Q${cx.toFixed(1)} ${cy.toFixed(1)} ${nx.toFixed(1)} ${ny.toFixed(1)}`;
        x = nx;
        y = ny;
    }

    d += `L${W} ${H}Z`;
    return d;
}

/** Plate geometry for a CitizenID; pure, no DOM: testable and memoizable */
export function buildPlate(citizenid, shape = 'poster') {
    const { w: W, h: H } = SHAPES[shape] ?? SHAPES.poster;
    const seed = hash32(citizenid || 'unknown');
    const next = rng(seed);

    const sky = SKIES[seed % SKIES.length];

    // Some skies have no disc: otherwise every image is the same sun over the same hills
    const overcast = next() < 0.22;

    // Several archetypes: one alone reads as one image in eight tints, not distinct plates
    const ARCHETYPES = ['ridges', 'skyline', 'coast', 'overhead'];
    const archetype = ARCHETYPES[Math.floor(next() * ARCHETYPES.length)];
    const overhead = archetype === 'overhead';

    // Overhead: high horizon, small high disc; reads as noon and breaks the run of sunsets
    const horizonY = overhead
        ? H * (0.26 + next() * 0.1)
        : H * (0.5 + next() * 0.16);

    // Light kept off the edges; sometimes low above the horizon, not always high
    const lightLow = !overhead && next() < 0.34;
    const light = {
        x: W * (0.12 + next() * 0.76),
        y: lightLow ? horizonY - H * (0.04 + next() * 0.1) : H * (0.08 + next() * 0.2),
        r: (W * 0.055) * (overhead ? 0.4 + next() * 0.3 : 0.7 + next() * 0.95),
        glow: overhead ? 4.5 + next() * 3 : 2.8 + next() * 3.4,
    };

    const ridgeBack = ridgePath(next, 3 + Math.floor(next() * 3), horizonY, H * 0.15, W, H);
    const ridgeFront = ridgePath(next, 2 + Math.floor(next() * 3), horizonY + H * 0.11, H * 0.115, W, H);

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

    // Zero palms is valid: adds variance across the wall
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

    // Haze thin and pale: layered light, not bars
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

// The wall re-renders the same citizens while paging and typing: geometry is cached
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
