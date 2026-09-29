import { useState } from 'react';

// Array.from, not split(''): keeps characters outside the BMP intact
function initialsOf(name) {
    const parts = String(name).trim().split(/\s+/).filter(Boolean).slice(0, 2);
    const letters = parts.map((part) => Array.from(part)[0] ?? '').join('');
    return letters ? letters.toUpperCase() : '?';
}

/** Discord avatar; a missing or unreachable URL falls back to initials, never a broken image */
export default function PortalAvatar({ name, url, large = false }) {
    const [failed, setFailed] = useState(false);

    const safe = typeof url === 'string' && url.startsWith('https://') ? url : null;
    const cls = `idavatar${large ? ' idavatar--lg' : ''}`;
    const px = large ? 56 : 32;

    if (!safe || failed) {
        return <span className={`${cls} idavatar--mark`} aria-hidden="true">{initialsOf(name)}</span>;
    }

    return (
        <img
            className={cls}
            src={safe}
            alt=""
            width={px}
            height={px}
            referrerPolicy="no-referrer"
            onError={() => setFailed(true)}
        />
    );
}
