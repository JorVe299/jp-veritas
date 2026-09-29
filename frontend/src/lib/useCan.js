import { createContext, useContext } from 'react';

// Explains locked controls only: backend/utils/permissions.js decides, on every request

// A missing capabilities field never means "may do everything"
const DENIED = {
    can: () => false,
    role: null,
    roleLabel: null,
};

export const CanContext = createContext(DENIED);

/**
 * From the /api/auth/me user; matrix changes apply on the next session refresh, no re-login
 * Null role: empty capabilities, every can() false (the backend 403s every admin route)
 * authDisabled: everything allowed, as the backend then lets everything through
 */
export function buildPermissions(user, authDisabled = false) {
    if (authDisabled) {
        return { can: () => true, role: null, roleLabel: null };
    }

    const list = Array.isArray(user?.capabilities)
        ? user.capabilities.filter((id) => typeof id === 'string')
        : null;

    if (!list) return DENIED;

    const granted = new Set(list);
    const label = typeof user?.roleLabel === 'string' ? user.roleLabel.trim() : '';

    return {
        can: (capability) => granted.has(capability),
        role: typeof user?.role === 'string' ? user.role : null,
        // No label: the role goes unnamed rather than invented
        roleLabel: label || null,
    };
}

/** `const { can, roleLabel } = useCan();` */
export function useCan() {
    return useContext(CanContext);
}
