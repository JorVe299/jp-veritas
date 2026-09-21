import { useState } from 'react';

// "Test Player" becomes "TP", "testplayer" becomes "T". Array.from instead
// of split('') so characters outside the BMP survive intact.
function initialsOf(name) {
    const parts = String(name).trim().split(/\s+/).filter(Boolean).slice(0, 2);
    const letters = parts.map((part) => Array.from(part)[0] ?? '').join('');
    return letters ? letters.toUpperCase() : '?';
}

/**
 * The Discord picture, with the initials underneath it.
 *
 * avatarUrl can be missing, and a URL that is set can still lead nowhere -
 * a deleted image, a CDN that is not reachable from this network. Both end
 * at the initials, never at a broken image icon.
 */
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
