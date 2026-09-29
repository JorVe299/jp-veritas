import { useState } from 'react';
import StatusNote from './StatusNote';
import RoleRow from './RoleRow';
import RoleCreate from './RoleCreate';
import { createRole, deleteRole, saveRoleOrder, updateRole } from '../api';
import { failureNote } from '../lib/writeFeedback';

/**
 * Roles, their ranking and Discord mapping; each operation saves on its own press
 * No draft, unlike the grid: one "Save" would bundle an irreversible delete with harmless edits
 */
export default function RoleRoster({
    roles,
    canEdit,
    maxRoles,
    counts,
    dirtyIds,
    onChanged,
}) {
    // One write at a time: a second would race the reload and target a stale list
    const [busy, setBusy] = useState(null);
    const [feedback, setFeedback] = useState(null);

    // Failure detail is the server's own sentence: it knows why it refused
    // Separate titles: a failed write is never headed with the success text
    const run = async ({ done, failed }, work) => {
        setBusy(done);
        setFeedback(null);
        try {
            const answer = await work();
            const body = answer?.data || {};
            setFeedback({
                tone: 'success',
                title: body.message || done,
                detail: body.hint || undefined,
            });

            // A failed reload is not a failed write: warn, never report the write as failed
            try {
                await onChanged();
            } catch {
                setFeedback({
                    tone: 'warn',
                    title: body.message || done,
                    detail: 'It went through, but the list could not be read again. '
                        + 'Close the sheet and open it once more to see where things stand.',
                });
            }
            return true;
        } catch (err) {
            setFeedback(failureNote(failed, err));
            return false;
        } finally {
            setBusy(null);
        }
    };

    const move = (id, delta) => {
        const from = roles.findIndex((role) => role.id === id);
        const to = from + delta;
        // Rank 1 is the owner: the server pins it on top, so nothing moves above it
        if (from < 1 || to < 1 || to >= roles.length) return;

        const order = roles.map((role) => role.id);
        order.splice(to, 0, order.splice(from, 1)[0]);
        run(
            { done: 'Ranking saved', failed: 'The ranking could not be saved' },
            () => saveRoleOrder(order),
        );
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
                        onSave={(id, patch) => run(
                            { done: 'Role saved', failed: 'The role could not be saved' },
                            () => updateRole(id, patch),
                        )}
                        onDelete={(id) => run(
                            { done: 'Role removed', failed: 'The role could not be removed' },
                            () => deleteRole(id),
                        )}
                    />
                ))}
            </ol>

            {canEdit && (
                <RoleCreate
                    roles={roles}
                    maxRoles={maxRoles}
                    busy={busy}
                    onCreate={(body) => run(
                        { done: 'Role created', failed: 'The role could not be created' },
                        () => createRole(body),
                    )}
                />
            )}
        </section>
    );
}
