import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from './Icon';
import StatusNote from './StatusNote';
import CapabilityMatrix from './CapabilityMatrix';
import RoleRoster from './RoleRoster';
import { fetchPermissions, savePermissions } from '../api';
import { useCan } from '../lib/useCan';
import { failureNote } from '../lib/writeFeedback';

const INITIAL = {
    status: 'loading', // 'loading' | 'ready' | 'error'
    data: null,
    error: null,
    hint: null,
};

// Backend order kept: it carries the domain ordering (Players, Inventory, Vehicles, ...)
function groupCapabilities(capabilities) {
    const order = [];
    const byGroup = new Map();

    capabilities.forEach((cap) => {
        const name = cap.group || 'Other';
        if (!byGroup.has(name)) {
            byGroup.set(name, []);
            order.push(name);
        }
        byGroup.get(name).push(cap);
    });

    return order.map((name) => ({ name, items: byGroup.get(name) }));
}

const sameList = (a, b) => {
    if (a.length !== b.length) return false;
    const left = [...a].sort();
    const right = [...b].sort();
    return left.every((id, i) => id === right[i]);
};

// Locked owner left out: holds everything, and the backend ignores it in the body
const editableRoles = (roles) => roles.filter((role) => !role.locked);

/**
 * Roles and permissions as a sheet: server-wide and too large for a citizen-wall card
 * Roster actions save at once; grid ticks are drafted and saved in one PUT
 * A PUT per tick would make every intermediate state live
 */
export default function PermissionsSheet({ onClose, onSaved }) {
    const { can } = useCan();
    const [state, setState] = useState(INITIAL);
    // { base, draft }: last saved matrix and the edited one; "unsaved" is derived, not tracked
    const [edit, setEdit] = useState(null);
    const [saving, setSaving] = useState(false);
    const [feedback, setFeedback] = useState(null);
    const closeRef = useRef(null);
    const alive = useRef(true);

    // Blocks late reload() writes; set on mount too: StrictMode re-runs effects after a cleanup
    useEffect(() => {
        alive.current = true;
        return () => { alive.current = false; };
    }, []);

    useEffect(() => {
        let cancelled = false;

        fetchPermissions()
            .then((answer) => {
                if (cancelled) return;
                const data = answer.data || {};
                setState({ status: 'ready', data, error: null, hint: null });
                setEdit({ base: data.matrix || {}, draft: startDraft(data) });
            })
            .catch((err) => {
                if (cancelled) return;
                const body = err.response?.data || {};
                setState({
                    status: 'error',
                    data: null,
                    error: body.error || err.message,
                    hint: body.hint || null,
                });
            });

        return () => { cancelled = true; };
    }, []);

    useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        closeRef.current?.focus();
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    const data = state.data;
    const roles = useMemo(() => (Array.isArray(data?.roles) ? data.roles : []), [data]);
    const capabilities = useMemo(
        () => (Array.isArray(data?.capabilities) ? data.capabilities : []),
        [data],
    );
    const groups = useMemo(() => groupCapabilities(capabilities), [capabilities]);

    // can() covers no-Discord mode: the route reports canEdit false there yet accepts the PUT
    const canEdit = data?.you?.canEdit === true || can('permissions.edit');

    // Refetch rather than patch: patching would re-implement the store's logic here
    const reload = async () => {
        const answer = await fetchPermissions();
        if (!alive.current) return;
        const next = answer.data || {};
        setState({ status: 'ready', data: next, error: null, hint: null });

        // Unsaved ticks survive the reload: creating a role mid-edit must not lose work
        setEdit((prev) => {
            const fresh = startDraft(next);
            if (prev) {
                Object.keys(fresh).forEach((id) => {
                    const before = prev.base[id];
                    const typed = prev.draft[id];
                    if (typed && before && !sameList(typed, before)) fresh[id] = [...typed];
                });
            }
            return { base: next.matrix || {}, draft: fresh };
        });

        // A deleted or re-permissioned role may be one's own
        onSaved?.();
    };

    // Memoised: a fresh {} per render would recompute the counts below
    const draft = useMemo(() => edit?.draft || {}, [edit]);

    const dirtyIds = useMemo(() => {
        const out = new Set();
        if (!edit) return out;
        editableRoles(roles).forEach((role) => {
            if (!sameList(edit.draft[role.id] || [], edit.base[role.id] || [])) out.add(role.id);
        });
        return out;
    }, [edit, roles]);

    const counts = useMemo(() => {
        const out = {};
        roles.forEach((role) => {
            out[role.id] = role.locked
                ? role.capabilityCount
                : (draft[role.id] || []).length;
        });
        return out;
    }, [roles, draft]);

    const changed = roles.filter((role) => dirtyIds.has(role.id)).map((role) => role.label);
    const dirty = changed.length > 0;

    const toggle = (roleId, capabilityId) => {
        setFeedback(null);
        setEdit((prev) => {
            if (!prev) return prev;
            const held = prev.draft[roleId] || [];
            const next = held.includes(capabilityId)
                ? held.filter((id) => id !== capabilityId)
                : [...held, capabilityId];
            return { ...prev, draft: { ...prev.draft, [roleId]: next } };
        });
    };

    // Server defaults only, no frontend list; roles made here have none and keep their ticks
    const resetToDefaults = () => {
        if (!data?.defaults) return;
        setFeedback(null);
        setEdit((prev) => {
            if (!prev) return prev;
            const next = { ...prev.draft };
            editableRoles(roles).forEach((role) => {
                const fallback = data.defaults[role.id];
                if (Array.isArray(fallback)) next[role.id] = [...fallback];
            });
            return { ...prev, draft: next };
        });
    };

    const discard = () => {
        setFeedback(null);
        setEdit((prev) => (prev
            ? { ...prev, draft: startDraft({ roles, matrix: prev.base }) }
            : prev));
    };

    const handleSave = async () => {
        if (!dirty || saving || !canEdit) return;

        setSaving(true);
        setFeedback(null);
        try {
            const body = {};
            editableRoles(roles).forEach((role) => { body[role.id] = draft[role.id] || []; });

            const answer = await savePermissions(body);
            const saved = answer.data?.matrix || body;

            setState((prev) => ({ ...prev, data: { ...prev.data, matrix: saved } }));
            setEdit({ base: saved, draft: startDraft({ roles, matrix: saved }) });
            setFeedback({
                tone: 'success',
                title: answer.data?.message || 'Permissions saved',
                detail: answer.data?.hint || 'Changes apply immediately, nobody has to sign in again.',
            });

            // One's own permissions may have changed
            onSaved?.();
        } catch (err) {
            setFeedback(failureNote('The permissions could not be saved', err));
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="sheet" role="dialog" aria-modal="true" aria-label="Roles and permissions">
            <button
                className="sheet__backdrop"
                type="button"
                aria-label="Close roles and permissions"
                onClick={onClose}
            />

            <div className="sheet__panel">
                <header className="sheet__head">
                    <Icon name="users" size={20} />
                    <div className="sheet__heading">
                        <h2 className="sheet__title">Roles and permissions</h2>
                        <p className="sheet__sub">{headSub(state, canEdit)}</p>
                    </div>
                    <button
                        ref={closeRef}
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={onClose}
                    >
                        {dirty ? 'Discard and close' : 'Close'}
                    </button>
                </header>

                <div className="sheet__body sheet__body--single">
                    {state.status === 'loading' && <p className="field__hint">Loading permissions…</p>}

                    {state.status === 'error' && (
                        <StatusNote
                            tone="error"
                            title="The permissions could not be loaded"
                            detail={[state.error, state.hint].filter(Boolean).join(' ')}
                        />
                    )}

                    {state.status === 'ready' && !canEdit && (
                        <StatusNote
                            tone="warn"
                            title="Only the owner can change roles or permissions"
                            detail="Read-only for your role."
                        />
                    )}

                    {state.status === 'ready' && edit && (
                        <>
                            <RoleRoster
                                roles={roles}
                                canEdit={canEdit}
                                maxRoles={data?.maxRoles || roles.length}
                                counts={counts}
                                dirtyIds={dirtyIds}
                                onChanged={reload}
                            />

                            <section className="roster__grid">
                                <h3 className="roster__title u-caps">What each role may do</h3>
                                <p className="field__hint">Ticks are saved together.</p>

                                <CapabilityMatrix
                                    roles={roles}
                                    groups={groups}
                                    draft={draft}
                                    canEdit={canEdit}
                                    saving={saving}
                                    onToggle={toggle}
                                />
                            </section>

                            {/* Stated here: the table leaves this right out */}
                            {data?.ownerOnly && (
                                <p className="field__hint">
                                    {`${data.ownerOnly} is owner-only and not grantable.`}
                                </p>
                            )}

                            {feedback && (
                                <StatusNote
                                    tone={feedback.tone}
                                    title={feedback.title}
                                    detail={feedback.detail}
                                />
                            )}
                        </>
                    )}
                </div>

                <footer className="panel__foot">
                    <span className="panel__footinfo">
                        {dirty
                            ? `Unsaved rights: ${changed.join(', ')}`
                            : 'No unsaved rights'}
                    </span>

                    <button
                        type="button"
                        className="btn btn--ghost"
                        onClick={resetToDefaults}
                        disabled={!canEdit || saving || state.status !== 'ready'}
                        title="Built-in roles only"
                    >
                        Reset to defaults
                    </button>

                    <button
                        type="button"
                        className="btn btn--ghost"
                        onClick={discard}
                        disabled={!dirty || saving}
                    >
                        Discard changes
                    </button>

                    <button
                        type="button"
                        className="btn btn--primary"
                        onClick={handleSave}
                        disabled={!dirty || saving || !canEdit}
                    >
                        {saving ? 'Saving…' : 'Save permissions'}
                    </button>
                </footer>
            </div>
        </div>
    );
}

// Copies, not references: discard needs the untouched base
function startDraft(data) {
    const draft = {};
    editableRoles(Array.isArray(data?.roles) ? data.roles : []).forEach((role) => {
        const list = data?.matrix?.[role.id];
        draft[role.id] = Array.isArray(list) ? [...list] : [];
    });
    return draft;
}

function headSub(state, canEdit) {
    if (state.status === 'loading') return 'Reading the permission table…';
    if (state.status === 'error') return 'The table could not be read.';

    const label = state.data?.you?.label;
    const who = label ? `You are ${label}. ` : '';
    return canEdit
        ? `${who}A change applies at once — nobody has to sign in again.`
        : `${who}This is read-only for you.`;
}
