import { useState } from 'react';

// The signed-in user in the top bar: picture, name, role, sign out.
// No dropdown - with exactly one entry that would be one click too many.

// "Test Admin" becomes "TA", "testadmin" becomes "T". Array.from instead
// of split('') so that characters outside the BMP survive intact too.
function initialsOf(name) {
    const parts = String(name).trim().split(/\s+/).filter(Boolean).slice(0, 2);
    const letters = parts.map((part) => Array.from(part)[0] ?? '').join('');
    return letters ? letters.toUpperCase() : '?';
}

export default function SessionMenu({ user, roleLabel, signingOut, onSignOut }) {
    // avatarUrl can be null, and even a URL that is set can still lead
    // nowhere (CDN unreachable, image deleted). Both end at the initials,
    // never at a broken image icon.
    const [avatarFailed, setAvatarFailed] = useState(false);

    const name = user?.globalName || user?.username || 'Signed in';
    // The name is cut to fit the bar, so the title has to hold all of it -
    // plus the handle, where that is not what is shown.
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

            <span className="session__name" title={fullName}>{name}</span>

            {/* The role sits next to the name, not only where a button is
                missing: anyone working under limits should know that up front
                and not puzzle over a greyed-out control. */}
            {roleLabel && (
                <span className="pill pill--fit session__role" title={roleLabel}>
                    <span className="u-clip">{roleLabel}</span>
                </span>
            )}

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
