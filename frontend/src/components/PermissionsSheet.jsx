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

// The permissions come with a group field. Grouping follows the order in
// which the backend sends them - that is where the domain ordering lives
// (Players, Inventory, Vehicles, ...), and the panel should not quietly
// re-sort it.
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

// Comparison of two permission lists regardless of order: whether a tick
// is set does not depend on the position it happens to have in the
// file.
const sameList = (a, b) => {
    if (a.length !== b.length) return false;
    const left = [...a].sort();
    const right = [...b].sort();
    return left.every((id, i) => id === right[i]);
};

// Only the editable roles. The owner drops out: he always has everything,
// may be absent from the body and is ignored by the backend anyway.
const editableRoles = (roles) => roles.filter((role) => !role.locked);

/**
 * Roles and permissions.
 *
 * A sheet of its own instead of a card in the module wall, for two reasons:
 * twenty permissions times however many roles a server has fit into no card
 * next to a citizen's job, and above all this is not about a citizen at
 * all. A card there claims by its position that its content belongs to the
 * selected character - this belongs to the whole server.
 *
 * Two halves, and they are saved differently on purpose:
 *
 *   - the roster above. Roles are records the owner keeps now, not four
 *     names compiled into the source. Each operation there is its own act
 *     and goes to the server when it is pressed.
 *   - the grid below. Changes are collected in a draft and written once. A
 *     PUT per tick would not only be noisy but dangerous: while working
 *     down the rows, every intermediate state would be live for a second.
 */
export default function PermissionsSheet({ onClose, onSaved }) {
    const { can } = useCan();
    const [state, setState] = useState(INITIAL);
    // { base, draft }: the matrix as the server last gave it, and the one
    // being edited. Keeping both means "what is unsaved" is an answer this
    // component can work out rather than remember.
    const [edit, setEdit] = useState(null);
    const [saving, setSaving] = useState(false);
    const [feedback, setFeedback] = useState(null);
    const closeRef = useRef(null);
    const alive = useRef(true);

    // A reload finishing after the sheet has gone must not write into it.
    // Set on the way in as well, because in development every effect is run
    // twice and the flag would otherwise stay false after the first tear-down.
    useEffect(() => {
        alive.current = true;
        return () => { alive.current = false; };
    }, []);

    useEffect(() => {
        // A late answer must no longer write into a sheet that has already
        // been closed.
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

    // Escape closes; the focus starts on the close button.
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

    /* The backend says whether this user may save. If the answer is no, the
       table stays readable and all ticks are locked - disappearing cannot
       explain itself.

       The second condition is not a loophole but covers a case in which
       the first one is untrue: without a Discord login there is no
       signed-in user, the route assumes 'citizen' for that and reports
       canEdit false - yet it would accept the PUT anyway, because with
       no role nobody gets checked. A locked button would then be the
       false statement. */
    const canEdit = data?.you?.canEdit === true || can('permissions.edit');

    // After a role was created, renamed, reordered or deleted the whole
    // answer is read again rather than patched in place: the ranking, the
    // counts and the matrix all move together, and guessing the new shape
    // here would be a second implementation of the store.
    const reload = async () => {
        const answer = await fetchPermissions();
        if (!alive.current) return;
        const next = answer.data || {};
        setState({ status: 'ready', data: next, error: null, hint: null });

        // Ticks that have not been saved yet survive the reload. Creating a
        // role halfway through re-permissioning another one is an ordinary
        // thing to do, and losing the work would be the panel's fault.
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

        // A deleted or re-permissioned role may be one's own.
        onSaved?.();
    };

    // Memoised so that the empty object before the first answer is not a
    // new one on every render - the counts below depend on it.
    const draft = useMemo(() => edit?.draft || {}, [edit]);

    const dirtyIds = useMemo(() => {
        const out = new Set();
        if (!edit) return out;
        editableRoles(roles).forEach((role) => {
            if (!sameList(edit.draft[role.id] || [], edit.base[role.id] || [])) out.add(role.id);
        });
        return out;
    }, [edit, roles]);

    // What the roster puts in each row: the count being edited, not the one
    // the server last saw.
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

    /* The default comes from the answer, not from a second list in the
       frontend - otherwise the panel would have an opinion of its own about
       what "default" means. It only knows the roles shipped with the panel,
       so a role this server made keeps what it has: resetting must not
       quietly empty the vehicle crew. */
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

            // One's own permission list may have just changed. Without this
            // step the panel would keep working with the earlier state until
            // the next load.
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
                            detail={'You can read all of it, so you can see which right a role is '
                                + 'missing and who ranks above whom — creating, renaming, '
                                + 'reordering and deleting are refused by the server, so those '
                                + 'controls are not here.'}
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
                                <p className="field__hint">
                                    Ticks are collected and written in one go — a role is
                                    half-re-permissioned for as long as it takes to work down
                                    the rows, and nobody should be holding that halfway state.
                                </p>

                                <CapabilityMatrix
                                    roles={roles}
                                    groups={groups}
                                    draft={draft}
                                    canEdit={canEdit}
                                    saving={saving}
                                    onToggle={toggle}
                                />
                            </section>

                            {/* Belongs here visibly, otherwise you look for
                                it in the table: the right to grant rights is
                                not in it and cannot be passed on. */}
                            {data?.ownerOnly && (
                                <p className="field__hint">
                                    {`Granting permissions itself (${data.ownerOnly}) is not in this table. `}
                                    It belongs to the owner alone, so nobody can hand it out — or
                                    lose it by accident. No role made here can be given it either.
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
                        title="Only the roles shipped with the panel have a default. Roles made here keep what they hold."
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

// The draft is a copy, not a reference: otherwise "Cancel" would no longer
// be possible, because the original state would already be overwritten.
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
