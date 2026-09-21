import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import Icon from './Icon';
import StatusNote from './StatusNote';
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
 * Roles and permissions as a matrix.
 *
 * A sheet of its own instead of a card in the module wall, for two reasons:
 * twenty permissions times four roles fit into no card next to a citizen's
 * job, and above all this is not about a citizen at all. A card there claims
 * by its position that its content belongs to the selected character - this
 * table applies to the whole server.
 *
 * Changes are collected in a draft and written once. A PUT per tick would
 * not only be noisy but dangerous: while working down the rows, every
 * intermediate state would be live for a second.
 */
export default function PermissionsSheet({ onClose, onSaved }) {
    const { can } = useCan();
    const [state, setState] = useState(INITIAL);
    const [draft, setDraft] = useState(null); // { [roleId]: string[] }
    const [saving, setSaving] = useState(false);
    const [feedback, setFeedback] = useState(null);
    const closeRef = useRef(null);

    useEffect(() => {
        // A late answer must no longer write into a sheet that has already
        // been closed.
        let cancelled = false;

        fetchPermissions()
            .then((answer) => {
                if (cancelled) return;
                const data = answer.data || {};
                setState({ status: 'ready', data, error: null, hint: null });
                setDraft(startDraft(data));
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

    const changed = useMemo(() => {
        if (!draft || !data?.matrix) return [];
        return editableRoles(roles)
            .filter((role) => !sameList(draft[role.id] || [], data.matrix[role.id] || []))
            .map((role) => role.label);
    }, [draft, data, roles]);

    const dirty = changed.length > 0;

    const toggle = (roleId, capabilityId) => {
        setFeedback(null);
        setDraft((prev) => {
            const held = prev?.[roleId] || [];
            const next = held.includes(capabilityId)
                ? held.filter((id) => id !== capabilityId)
                : [...held, capabilityId];
            return { ...prev, [roleId]: next };
        });
    };

    // The default comes from the answer, not from a second list in the
    // frontend - otherwise the panel would have an opinion of its own about
    // what "default" means.
    const resetToDefaults = () => {
        if (!data?.defaults) return;
        setFeedback(null);
        setDraft(startDraft({ ...data, matrix: data.defaults }));
    };

    const discard = () => {
        setFeedback(null);
        setDraft(startDraft(data));
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
            setDraft(startDraft({ roles, matrix: saved }));
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
                            title="Only the owner can change this table"
                            detail="You can read it, so you can see which right a role is missing — saving is refused by the server."
                        />
                    )}

                    {state.status === 'ready' && draft && (
                        <>
                            <table className="matrix">
                                <thead>
                                    <tr>
                                        <th scope="col" className="matrix__what">Right</th>
                                        {roles.map((role) => (
                                            <th scope="col" key={role.id} className="matrix__col">
                                                <span className="matrix__role">{role.label}</span>
                                                {role.locked && (
                                                    <span className="matrix__note">Always all</span>
                                                )}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>

                                <tbody>
                                    {groups.map((group) => (
                                        <Fragment key={group.name}>
                                            <tr>
                                                <th
                                                    scope="colgroup"
                                                    colSpan={roles.length + 1}
                                                    className="matrix__group u-caps"
                                                >
                                                    {group.name}
                                                </th>
                                            </tr>

                                            {group.items.map((cap) => (
                                                <tr key={cap.id} className="matrix__row">
                                                    <th scope="row" className="matrix__what">
                                                        <span className="matrix__label">{cap.label}</span>
                                                        <span className="matrix__id u-mono">{cap.id}</span>
                                                    </th>

                                                    {roles.map((role) => (
                                                        <td key={role.id} className="matrix__cell">
                                                            {role.locked ? (
                                                                /* The owner is not editable. A dead
                                                                   tick would look like a control -
                                                                   so what stands here is a tick
                                                                   with the word alongside it. */
                                                                <span className="matrix__always">
                                                                    <Icon name="check" size={15} />
                                                                    <span className="matrix__word">Always</span>
                                                                    <span className="u-sr">
                                                                        {`${cap.label}: always granted for ${role.label}`}
                                                                    </span>
                                                                </span>
                                                            ) : (
                                                                <input
                                                                    type="checkbox"
                                                                    className="matrix__box"
                                                                    checked={(draft[role.id] || []).includes(cap.id)}
                                                                    disabled={!canEdit || saving}
                                                                    onChange={() => toggle(role.id, cap.id)}
                                                                    aria-label={`${cap.label} — ${role.label}`}
                                                                />
                                                            )}
                                                        </td>
                                                    ))}
                                                </tr>
                                            ))}
                                        </Fragment>
                                    ))}
                                </tbody>
                            </table>

                            {/* Belongs here visibly, otherwise you look for
                                it in the table: the right to grant rights is
                                not in it and cannot be passed on. */}
                            {data?.ownerOnly && (
                                <p className="field__hint">
                                    {`Granting permissions itself (${data.ownerOnly}) is not in this table. `}
                                    It belongs to the owner alone, so nobody can hand it out — or
                                    lose it by accident.
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
                            ? `Unsaved: ${changed.join(', ')}`
                            : 'No change'}
                    </span>

                    <button
                        type="button"
                        className="btn btn--ghost"
                        onClick={resetToDefaults}
                        disabled={!canEdit || saving || state.status !== 'ready'}
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
        : `${who}This table is read-only for you.`;
}
