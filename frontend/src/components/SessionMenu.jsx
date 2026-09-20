import { useState } from 'react';

// Der angemeldete Nutzer in der Kopfleiste: Bild, Name, Abmelden. Kein
// Klappmenue - bei genau einem Eintrag waere das ein Klick zu viel.

// Aus "Test Admin" wird "TA", aus "testadmin" ein "T". Array.from statt
// split(''), damit auch Zeichen ausserhalb der BMP heil bleiben.
function initialsOf(name) {
    const parts = String(name).trim().split(/\s+/).filter(Boolean).slice(0, 2);
    const letters = parts.map((part) => Array.from(part)[0] ?? '').join('');
    return letters ? letters.toUpperCase() : '?';
}

export default function SessionMenu({ user, signingOut, onSignOut }) {
    // avatarUrl kann null sein, und eine gesetzte URL kann trotzdem ins
    // Leere laufen (CDN nicht erreichbar, Bild geloescht). Beides endet
    // bei den Initialen, nie bei einem kaputten Bildsymbol.
    const [avatarFailed, setAvatarFailed] = useState(false);

    const name = user?.globalName || user?.username || 'Signed in';
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

            <span className="session__name" title={user?.username || undefined}>{name}</span>

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
