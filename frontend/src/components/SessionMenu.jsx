import { useState } from 'react';

// Array.from, not split(''): keeps characters outside the BMP intact
function initialsOf(name) {
    const parts = String(name).trim().split(/\s+/).filter(Boolean).slice(0, 2);
    const letters = parts.map((part) => Array.from(part)[0] ?? '').join('');
    return letters ? letters.toUpperCase() : '?';
}

/** Signed-in user with an inline sign-out: no dropdown for a single action */
export default function SessionMenu({ user, roleLabel, signingOut, onSignOut }) {
    // Null or dead avatar URL (CDN down, image deleted): initials, never a broken image
    const [avatarFailed, setAvatarFailed] = useState(false);

    const name = user?.globalName || user?.username || 'Signed in';
    // The bar truncates the name; the title carries it in full
    const fullName = user?.username && user.username !== name ? `${name} (${user.username})` : name;
    const avatarUrl = typeof user?.avatarUrl === 'string' && user.avatarUrl.startsWith('https://')
        ? user.avatarUrl
        : null;

    return (
        <div className="session">
            {avatarUrl && !avatarFailed ? (
                <img
                    className="session__avatar"
                    src={avatarUrl}
                    alt=""
                    width="28"
                    height="28"
                    referrerPolicy="no-referrer"
                    onError={() => setAvatarFailed(true)}
                />
            ) : (
                <span className="session__avatar session__avatar--mark" aria-hidden="true">
                    {initialsOf(name)}
                </span>
            )}

            {/* Role up front: limits are known before a control turns up disabled */}
            <span className="session__who">
                <span className="session__name" title={fullName}>{name}</span>
                {roleLabel && (
                    <span className="session__role" title={roleLabel}>{roleLabel}</span>
                )}
            </span>

            <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={onSignOut}
                disabled={signingOut}
            >
                {signingOut ? 'Signing out…' : 'Sign out'}
            </button>
        </div>
    );
}
