// Deterministic key-image generation ("plate") per citizen.
//
// The reason: the surface is a wall of tiles, but characters have no image
// material. Instead of empty rectangles or an avatar service, the motif is
// derived from the CitizenID. Same ID -> same image, always, with no network
// and no stored state. The image is thereby a recognizable trait of the
// record, not decoration.

/** FNV-1a (32 bit). Small, fast, well spread for short strings. */
function hash32(input) {
    let h = 0x811c9dc5;
    const s = String(input ?? '');
    for (let i = 0; i < s.length; i += 1) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
}

/** Mulberry32: a reproducible sequence of numbers in [0,1) from one seed. */
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

// Eight skies from the Los Santos day cycle. Each palette is a duotone:
// zenith -> horizon, plus a light source and the silhouette color.
// The color of the surface deliberately sits here and not in the chrome.
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

// Two crops: the portrait format of the tiles and a widescreen one for the
// header. The widescreen one is built in its own right instead of cropping
// the portrait - otherwise only a middle strip of the composition would remain.
const SHAPES = {
    poster: { w: 200, h: 300 },
    wide: { w: 400, h: 225 },
};

/**
 * Builds a contour line as an SVG path that is closed at the bottom.
 * peaks controls the jaggedness, baseY the height at the edge.
 */
function ridgePath(next, peaks, baseY, amplitude, W, H) {
    const step = W / peaks;
    let d = `M0 ${H}L0 ${baseY}`;
    let x = 0;
    let y = baseY;

    for (let i = 0; i < peaks; i += 1) {
        const nx = x + step;
        // Target height of the next point, around baseY
        const ny = baseY - amplitude * next() + amplitude * 0.35;
        // A control point in the middle produces the soft ridge back
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
 * Produces the complete image description for a CitizenID.
 * Pure computation, no DOM, so it can be tested and memoized.
 */
export function buildPlate(citizenid, shape = 'poster') {
    const { w: W, h: H } = SHAPES[shape] ?? SHAPES.poster;
    const seed = hash32(citizenid || 'unknown');
    const next = rng(seed);

    const sky = SKIES[seed % SKIES.length];

    // A fifth of the skies are overcast and have no disc at all. Without it
    // every image looks like the same sun over the same hills.
    const overcast = next() < 0.22;

    // Four build types instead of one. With only one, the wall read as a
    // single image in eight color tones - which dropped exactly the
    // distinguishability the images are generated for in the first place.
    const ARCHETYPES = ['ridges', 'skyline', 'coast', 'overhead'];
    const archetype = ARCHETYPES[Math.floor(next() * ARCHETYPES.length)];
    const overhead = archetype === 'overhead';

    // Overhead pushes the horizon up: the ground takes up almost the whole
    // image, the disc sits small and high. That reads as noon instead of
    // dusk and breaks up the run of sunsets.
    const horizonY = overhead
        ? H * (0.26 + next() * 0.1)
        : H * (0.5 + next() * 0.16);

    // Light source: never exactly centered, never right at the edge, and
    // seldom close above the horizon instead of always high in the frame.
    const lightLow = !overhead && next() < 0.34;
    const light = {
        x: W * (0.12 + next() * 0.76),
        y: lightLow ? horizonY - H * (0.04 + next() * 0.1) : H * (0.08 + next() * 0.2),
        r: (W * 0.055) * (overhead ? 0.4 + next() * 0.3 : 0.7 + next() * 0.95),
        glow: overhead ? 4.5 + next() * 3 : 2.8 + next() * 3.4,
    };

    const ridgeBack = ridgePath(next, 3 + Math.floor(next() * 3), horizonY, H * 0.15, W, H);
    const ridgeFront = ridgePath(next, 2 + Math.floor(next() * 3), horizonY + H * 0.11, H * 0.115, W, H);

    // Skyline: a built-up edge made of blocks on the front ridge.
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

    // Coast: a stretch of water below the horizon with a trail of light.
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

    // Palms stand on the front ridge. Zero is a valid result: not every
    // image needs them, and it raises the variance across the wall.
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

    // Haze bands above the horizon. Deliberately thin and pale: they should
    // read as layering in the light, not as bars on the surface.
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

// The wall re-renders the same citizens over and over while paging and typing.
// A small cache keeps the geometry from being rolled anew every time.
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
