import { useId } from 'react';
import { getPlate } from '../lib/plate';

// Der Palmen-Umriss liegt einmal als <symbol> im Dokument. Jede Kachel
// referenziert ihn per <use>, statt denselben Pfad 15x zu wiederholen.
export function PlateSprite() {
    return (
        <svg className="sprite" aria-hidden="true" focusable="false">
            <symbol id="ls-palm" viewBox="0 0 44 42">
                <path d="M20.4 42c.6-10 1.6-20 2.6-29.5l2.6.3c-1.2 9.2-2 19.2-2.2 29.2Z" />
                <path d="M24 12q10-6 18-3-9-.5-17.2 5Z" />
                <path d="M24 12q9 2 15 9-8-5.5-15-6.4Z" />
                <path d="M24 12q-10-6-18-4 9 .6 17.4 6Z" />
                <path d="M24 12q-9 2-15 10 8-6 14.6-7.2Z" />
                <path d="M24 12q1-8 7-12-5 7-5.4 12.6Z" />
                <path d="M24 12q-3-7-9-11 6 6 7.6 12.8Z" />
            </symbol>
        </svg>
    );
}

/**
 * Das erzeugte Schluesselbild eines Citizens.
 *
 * `shape` waehlt den Zuschnitt: 'poster' fuer die Kacheln, 'wide' fuer den
 * Kopfbereich. Das Breitbild wird eigens erzeugt statt das Hochformat zu
 * beschneiden - sonst bliebe von der Komposition nur ein Mittelstreifen.
 */
export default function Plate({ citizenid, shape = 'poster', className = '' }) {
    const plate = getPlate(citizenid, shape);
    const uid = useId().replace(/:/g, '');
    const skyId = `sky-${uid}`;
    const glowId = `glow-${uid}`;
    const bandId = `band-${uid}`;

    const {
        sky, light, overcast, ridgeBack, ridgeFront, palms, bands,
        horizonY, width, height, towers, coast,
    } = plate;

    return (
        <svg
            className={`plate ${className}`.trim()}
            viewBox={plate.viewBox}
            preserveAspectRatio="xMidYMid slice"
            aria-hidden="true"
            focusable="false"
        >
            <defs>
                <linearGradient id={skyId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={sky.zenith} />
                    <stop offset={`${Math.round((horizonY / height) * 100)}%`} stopColor={sky.horizon} />
                    <stop offset="100%" stopColor={sky.horizon} />
                </linearGradient>
                <radialGradient id={glowId}>
                    <stop offset="0%" stopColor={sky.light} stopOpacity={overcast ? '0.4' : '0.85'} />
                    <stop offset="55%" stopColor={sky.light} stopOpacity={overcast ? '0.14' : '0.22'} />
                    <stop offset="100%" stopColor={sky.light} stopOpacity="0" />
                </radialGradient>
                {/* Dunst braucht weiche Kanten. Als einfaches Rechteck wird
                    daraus im Breitbild - rund sechsfach vergroessert - ein
                    Balken mit harter Ober- und Unterkante. */}
                <linearGradient id={bandId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={sky.haze} stopOpacity="0" />
                    <stop offset="50%" stopColor={sky.haze} stopOpacity="1" />
                    <stop offset="100%" stopColor={sky.haze} stopOpacity="0" />
                </linearGradient>
            </defs>

            <rect width={width} height={height} fill={`url(#${skyId})`} />

            {/* Lichtquelle: erst der weiche Hof, dann die harte Scheibe.
                Ein bedeckter Himmel behaelt den Hof und verliert die Scheibe. */}
            <circle cx={light.x} cy={light.y} r={light.r * light.glow} fill={`url(#${glowId})`} />
            {!overcast && (
                <circle cx={light.x} cy={light.y} r={light.r} fill={sky.light} opacity="0.92" />
            )}

            {/* Dunstbaender ueber dem Horizont */}
            {bands.map((b, i) => (
                <rect
                    key={i}
                    x={b.x}
                    y={b.y}
                    width={b.w}
                    height={b.h}
                    fill={`url(#${bandId})`}
                    opacity={b.o}
                />
            ))}

            {/* Zwei Ruecken: der hintere blasser, das gibt die Tiefe */}
            <path d={ridgeBack} fill={sky.land} opacity="0.58" />

            {/* Coast: Wasserflaeche mit Lichtspur, zwischen den Ruecken */}
            {coast && (
                <g>
                    <rect
                        x="0"
                        y={coast.y}
                        width={width}
                        height={height - coast.y}
                        fill={sky.light}
                        opacity="0.1"
                    />
                    {coast.glints.map((g, i) => (
                        <rect
                            key={i}
                            x={light.x - g.w / 2}
                            y={coast.y + (height - coast.y) * g.y}
                            width={g.w}
                            height={Math.max(1, height * 0.004)}
                            fill={sky.light}
                            opacity={g.o}
                        />
                    ))}
                </g>
            )}

            {/* Skyline: eine Bebauungskante aus Bloecken vor dem Horizont */}
            {towers.length > 0 && (
                <g fill={sky.land} opacity="0.88">
                    {towers.map((t, i) => (
                        <rect key={i} x={t.x} y={t.y} width={t.w} height={t.h + height * 0.1} />
                    ))}
                </g>
            )}

            <path d={ridgeFront} fill={sky.land} />

            {palms.map((p, i) => (
                <use
                    key={i}
                    href="#ls-palm"
                    x={-22}
                    y={-42}
                    width="44"
                    height="42"
                    fill={sky.land}
                    transform={`translate(${p.x.toFixed(1)} ${p.y.toFixed(1)}) scale(${(p.flip ? -p.scale : p.scale).toFixed(2)} ${p.scale.toFixed(2)})`}
                />
            ))}
        </svg>
    );
}
