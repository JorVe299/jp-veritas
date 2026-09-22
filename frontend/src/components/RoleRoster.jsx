import { useState } from 'react';
import StatusNote from './StatusNote';
import RoleRow from './RoleRow';
import RoleCreate from './RoleCreate';
import { createRole, deleteRole, saveRoleOrder, updateRole } from '../api';
import { failureNote } from '../lib/writeFeedback';

/**
 * The roles themselves: who exists, in which order, and who holds them.
 *
 * Unlike the grid below, nothing here is collected into a draft. Creating,
 * renaming, remapping, reordering and deleting each go to the server on
 * their own press and are done when the row comes back. That is deliberate:
 * a draft is right for twenty ticks that only mean something together, and
 * wrong for five separate operations of which one deletes a role - "Save"
 * would then be one button carrying an irreversible act among four harmless
 * ones.
 */
export default function RoleRoster({
    roles,
    canEdit,
    maxRoles,
    counts,
    dirtyIds,
    onChanged,
}) {
    // One operation at a time. The list is rebuilt from the server after
    // every one of them, and a second write racing the reload would be
    // written against a list that no longer exists.
    const [busy, setBusy] = useState(null);
    const [feedback, setFeedback] = useState(null);

    /**
     * Runs one write and turns the answer into the note above the list.
     * The failure text is the server's own sentence - it knows why it
     * refused, and repeating that in our words would at best be a
     * translation and at worst a different reason.
     */
    const run = async (title, work) => {
        setBusy(title);
        setFeedback(null);
        try {
            const answer = await work();
            const body = answer?.data || {};
            setFeedback({
                tone: 'success',
                title: body.message || title,
                detail: body.hint || undefined,
            });

            // Reading the list back is a second request and can fail on its
            // own. If it does, the write still went through - saying it did
            // not would be the one wrong thing to report here.
            try {
                await onChanged();
            } catch {
                setFeedback({
                    tone: 'warn',
                    title: body.message || title,
                    detail: 'It went through, but the list could not be read again. '
                        + 'Close the sheet and open it once more to see where things stand.',
                });
            }
            return true;
        } catch (err) {
            setFeedback(failureNote(title, err));
            return false;
        } finally {
            setBusy(null);
        }
    };

    const move = (id, delta) => {
        const from = roles.findIndex((role) => role.id === id);
        const to = from + delta;
        // Rank 1 is the owner: the server puts it back on top whatever it is
        // sent, so an offer to move something above it would be a lie.
        if (from < 1 || to < 1 || to >= roles.length) return;

        const order = roles.map((role) => role.id);
        order.splice(to, 0, order.splice(from, 1)[0]);
        run('Ranking saved', () => saveRoleOrder(order));
    };

    const total = roles.length;

    return (
        <section className="roster">
            <div className="roster__head">
                <h3 className="roster__title u-caps">Roles</h3>
                <p className="field__hint">
                    {canEdit
                        ? 'This list is the ranking, and the ranking decides what people can '
                            + 'do: somebody who matches two of these roles in Discord holds the '
                            + 'one nearer the top, and only that one. Move a role and you have '
                            + 'changed who wins — the owner stays first and cannot be moved. '
                            + 'Everything in this list is saved the moment it is pressed; only '
                            + 'the grid below is collected and saved in one go.'
                        : 'This list is the ranking: somebody who matches two of these roles '
                            + 'in Discord holds the one nearer the top, and only that one. '
                            + 'Changing it is the owner’s alone.'}
                </p>
            </div>

            {feedback && (
                <StatusNote
                    tone={feedback.tone}
                    title={feedback.title}
                    detail={feedback.detail}
                />
            )}

            <ol className="lines">
                {roles.map((role, index) => (
                    <RoleRow
                        key={role.id}
                        role={role}
                        rank={index + 1}
                        total={total}
                        canEdit={canEdit}
                        busy={busy}
                        count={counts[role.id] ?? role.capabilityCount}
                        dirty={dirtyIds.has(role.id)}
                        onMove={move}
                        onSave={(id, patch) => run('Role saved', () => updateRole(id, patch))}
                        onDelete={(id) => run('Role removed', () => deleteRole(id))}
                    />
                ))}
            </ol>

            {canEdit && (
                <RoleCreate
                    roles={roles}
                    maxRoles={maxRoles}
                    busy={busy}
                    onCreate={(body) => run('Role created', () => createRole(body))}
                />
            )}
        </section>
    );
}
