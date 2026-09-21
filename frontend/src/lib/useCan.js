import { createContext, useContext } from 'react';

// Permissions in the frontend.
//
// Important for context: nothing is decided here. The decision is made in
// backend/utils/permissions.js, and on every single request at that. What
// stands here only serves the explanation - so nobody presses a button that
// comes back with a 403 anyway, and so you can see why instead of facing a
// silently missing control.

// The safe starting point. Without a known permission list nothing counts
// as allowed: a missing capabilities field must never mean "may do
// everything". Better one button too many disabled than one too many open.
const DENIED = {
    can: () => false,
    role: null,
    roleLabel: null,
};

export const CanContext = createContext(DENIED);

/**
 * Builds the permission view from the user that /api/auth/me delivered.
 *
 * `capabilities` is read fresh from the matrix on every call there - so a
 * change takes effect without a re-login, as soon as the session has been
 * reloaded once.
 *
 * `role` may be null. That is not a weaker role but no role at all - the
 * account exists for Veritas ID and holds nothing in the panel, so
 * capabilities arrives empty and every can() here answers false. Which is
 * exactly right: the backend answers 403 on every admin route for such an
 * account. Nobody with a null role is routed to the panel in the first
 * place (see App.jsx), and if one ever got here anyway, what they would
 * find is a surface with everything locked rather than one that guesses.
 *
 * authDisabled is not a loophole but the truth: without a Discord login
 * there is no role, and the middleware in the backend then lets absolutely
 * everything through. Locking the UI here would be a claim the server does
 * not back - and the warning bar already says that the panel stands open to
 * anyone in this state.
 */
export function buildPermissions(user, authDisabled = false) {
    if (authDisabled) {
        return { can: () => true, role: null, roleLabel: null };
    }

    const list = Array.isArray(user?.capabilities)
        ? user.capabilities.filter((id) => typeof id === 'string')
        : null;

    // No field, no assumption.
    if (!list) return DENIED;

    const granted = new Set(list);
    const label = typeof user?.roleLabel === 'string' ? user.roleLabel.trim() : '';

    return {
        can: (capability) => granted.has(capability),
        role: typeof user?.role === 'string' ? user.role : null,
        // Empty instead of guessed: without a label the role simply is not
        // named in the sentence rather than being invented.
        roleLabel: label || null,
    };
}

/** `const { can, roleLabel } = useCan();` - that is how every card asks. */
export function useCan() {
    return useContext(CanContext);
}
