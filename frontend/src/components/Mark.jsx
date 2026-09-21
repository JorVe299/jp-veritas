import { useId } from 'react';

// The wordmark stays "Veritas"; the symbol is new.
// Motif: a tile in the aspect ratio of the wall, with a V cut out of it as
// a notch. The right leg runs out past the edge of the tile and turns from
// a notch into a solid form there.
export default function Mark({ size = 26, className = '' }) {
    const uid = useId().replace(/:/g, '');
    const maskId = `mark-${uid}`;

    return (
        <svg
            className={`mark ${className}`.trim()}
            width={size}
            height={size}
            viewBox="0 0 32 32"
            fill="none"
            aria-hidden="true"
            focusable="false"
        >
            <mask id={maskId}>
                <rect x="4" y="5" width="22" height="24" rx="3.5" fill="#fff" />
                <path
                    d="M9.5 9 15 21.5 20.5 9"
                    fill="none"
                    stroke="#000"
                    strokeWidth="4.2"
                    strokeLinejoin="miter"
                />
            </mask>

            <rect x="4" y="5" width="22" height="24" rx="3.5" fill="currentColor" mask={`url(#${maskId})`} />
            <path d="M20.5 9 24.8 0.9" stroke="currentColor" strokeWidth="4.2" strokeLinecap="butt" />
        </svg>
    );
}
