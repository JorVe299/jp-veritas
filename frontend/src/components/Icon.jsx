// A single, self-drawn icon set. All symbols share the same 24px grid, the
// same stroke weight and the same line caps, so that side by side they read
// as one family. Unicode characters as substitutes (⌕, ✓, ⚠) are
// deliberately no longer used anywhere: they follow the system font and
// break the flow of the lines.

const PATHS = {
    search: <><circle cx="11" cy="11" r="6.25" /><path d="M15.6 15.6 20 20" /></>,
    chevronLeft: <path d="M14.5 5.5 8 12l6.5 6.5" />,
    chevronRight: <path d="M9.5 5.5 16 12l-6.5 6.5" />,
    check: <path d="M4.8 12.4 9.6 17.2 19.2 7.2" />,
    cross: <path d="M6.4 6.4 17.6 17.6M17.6 6.4 6.4 17.6" />,
    warn: <><path d="M12 4.6 21.2 19.4H2.8Z" /><path d="M12 10.4v3.6" /><path d="M12 16.9h.01" /></>,
    info: <><circle cx="12" cy="12" r="8.2" /><path d="M12 11.2v5" /><path d="M12 7.9h.01" /></>,
    briefcase: <><rect x="3" y="7.4" width="18" height="12.2" rx="2" /><path d="M8.6 7.4V5.9a1.9 1.9 0 0 1 1.9-1.9h3a1.9 1.9 0 0 1 1.9 1.9v1.5" /><path d="M3 12.6h18" /></>,
    cash: <><rect x="2.6" y="6" width="18.8" height="12" rx="2" /><circle cx="12" cy="12" r="2.6" /><path d="M6.2 9.6v4.8M17.8 9.6v4.8" /></>,
    bank: <><path d="M3.4 9.6 12 4.4l8.6 5.2" /><path d="M5.6 9.6v8M10 9.6v8M14 9.6v8M18.4 9.6v8" /><path d="M3 19.6h18" /></>,
    plus: <path d="M12 5.6v12.8M5.6 12h12.8" />,
    minus: <path d="M5.6 12h12.8" />,
    link: <><path d="M10 13.6a3.6 3.6 0 0 0 5.4.4l2.6-2.6a3.7 3.7 0 0 0-5.2-5.2l-1.5 1.5" /><path d="M14 10.4a3.6 3.6 0 0 0-5.4-.4L6 12.6a3.7 3.7 0 0 0 5.2 5.2l1.5-1.5" /></>,
    linkOff: <><path d="M10.6 13a3.6 3.6 0 0 0 4.8.8" /><path d="M13.4 11a3.6 3.6 0 0 0-4.8-.8" /><path d="M4 4l16 16" /><path d="M14.5 7.7 16 6.2a3.7 3.7 0 0 1 5.2 5.2l-1.6 1.6" /><path d="M9.5 16.3 8 17.8a3.7 3.7 0 0 1-5.2-5.2l1.6-1.6" /></>,
    empty: <><rect x="3.4" y="4.6" width="17.2" height="14.8" rx="2.2" /><path d="M3.4 15.1 8 10.9l4.3 3.9 3-2.6 5.3 4.4" /><circle cx="9.2" cy="9" r="1.4" /></>,
    car: <><path d="M4.6 14.2 6.2 8.7a2 2 0 0 1 1.92-1.45h7.76a2 2 0 0 1 1.92 1.45l1.6 5.5" /><rect x="2.9" y="14.2" width="18.2" height="4.6" rx="1.6" /><path d="M6.9 16.5h.01M17.1 16.5h.01" /></>,
    box: <><path d="M12 3.6 20.4 7.8v8.4L12 20.4 3.6 16.2V7.8Z" /><path d="M3.6 7.8 12 12l8.4-4.2" /><path d="M12 12v8.4" /></>,
    id: <><rect x="2.9" y="5" width="18.2" height="14" rx="2" /><circle cx="8.8" cy="10.8" r="2.2" /><path d="M5.5 16.3a3.9 3.9 0 0 1 6.6 0" /><path d="M14.8 10.2h3.8M14.8 13.6h3.8" /></>,
    pulse: <path d="M2.9 12h4.1l2-4.8 3.2 9.6 2.2-4.8h6.7" />,
    ban: <><circle cx="12" cy="12" r="8.2" /><path d="M6.2 6.2 17.8 17.8" /></>,
    users: <><circle cx="9.4" cy="9.2" r="3.1" /><path d="M3.6 19a5.9 5.9 0 0 1 11.6 0" /><path d="M16.2 6.4a3.1 3.1 0 0 1 0 5.8" /><path d="M17.4 14.4a5.9 5.9 0 0 1 3 4.6" /></>,
    pin: <><path d="M12 20.6s6.2-5.6 6.2-10.2a6.2 6.2 0 0 0-12.4 0C5.8 15 12 20.6 12 20.6Z" /><circle cx="12" cy="10.2" r="2.3" /></>,
    bolt: <path d="M13.4 3.2 5.6 13.4h5.2l-.6 7.4 7.8-10.2h-5.2Z" />,
    // Two racked units: the installation itself, as opposed to the people on it.
    server: <><rect x="3.2" y="4.6" width="17.6" height="6.2" rx="1.8" /><rect x="3.2" y="13.2" width="17.6" height="6.2" rx="1.8" /><path d="M6.8 7.7h.01M6.8 16.3h.01" /><path d="M16.4 7.7h2.2M16.4 16.3h2.2" /></>,
};

export default function Icon({ name, size = 18, className = '', title }) {
    const shape = PATHS[name];
    if (!shape) return null;

    return (
        <svg
            className={`icon ${className}`.trim()}
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            role={title ? 'img' : 'presentation'}
            aria-hidden={title ? undefined : 'true'}
            aria-label={title}
            focusable="false"
        >
            {title && <title>{title}</title>}
            {shape}
        </svg>
    );
}
