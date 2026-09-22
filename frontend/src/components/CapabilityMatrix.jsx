import { Fragment, useState } from 'react';
import Icon from './Icon';

/**
 * Rows are capabilities, columns are roles.
 *
 * The table stays a table now that roles are made rather than shipped, and
 * that was a decision rather than the path of least resistance. A role
 * selector - one role at a time, picked from a dropdown - would have scaled
 * to forty columns without a scrollbar, but it would have taken away the
 * one thing this grid is read for: whether the new vehicle crew may do
 * anything the old one may not. That comparison is the whole question. A
 * dropdown answers it by making you remember the other column.
 *
 * So it keeps the columns and takes on the width instead:
 *
 *   - the capability column is sticky, so a column ten across still says
 *     which right it is ticking,
 *   - the sheet's body scrolls sideways once the columns no longer fit,
 *   - and past half a dozen roles each column can be folded away, which
 *     changes nothing that is saved. Comparing two of ten roles is done by
 *     putting the other eight aside, not by scrolling between them.
 *
 * A new role appears here the moment it exists, with nothing ticked.
 */
export default function CapabilityMatrix({
    roles,
    groups,
    draft,
    canEdit,
    saving,
    onToggle,
}) {
    // Hidden rather than visible: a role created a minute ago is then shown
    // without anybody having to remember to switch it on.
    const [hidden, setHidden] = useState(() => new Set());

    const shown = roles.filter((role) => !hidden.has(role.id));
    const offerFolding = roles.length > 5;

    const fold = (id) => {
        setHidden((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    const countOf = (role) => (role.locked
        ? role.capabilityCount
        : (draft[role.id] || []).length);

    return (
        <>
            {offerFolding && (
                <div className="matrix__folds">
                    <span className="matrix__foldlabel">
                        {`Showing ${shown.length} of ${roles.length} columns.`}
                        {' '}
                        Folding one away only clears the screen — nothing is changed by it.
                    </span>
                    <div className="matrix__foldrow">
                        {roles.map((role) => {
                            const open = !hidden.has(role.id);
                            return (
                                <button
                                    key={role.id}
                                    type="button"
                                    className={`pill pill--drop ${open ? '' : 'matrix__folded'}`.trim()}
                                    onClick={() => fold(role.id)}
                                    aria-pressed={open}
                                >
                                    <Icon name={open ? 'check' : 'plus'} size={13} className="pill__x" />
                                    {role.label}
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}

            {shown.length === 0 ? (
                <p className="field__hint">
                    Every column is folded away. Bring a role back to see what it may do.
                </p>
            ) : (
                <table className="matrix">
                    <thead>
                        <tr>
                            <th scope="col" className="matrix__what matrix__corner">Right</th>
                            {shown.map((role) => (
                                <th scope="col" key={role.id} className="matrix__col">
                                    <span className="matrix__role">{role.label}</span>
                                    <span className="matrix__note">
                                        {role.locked
                                            ? 'Always all'
                                            : `${countOf(role)} granted`}
                                    </span>
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
                                        colSpan={shown.length + 1}
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

                                        {shown.map((role) => (
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
                                                        onChange={() => onToggle(role.id, cap.id)}
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
            )}
        </>
    );
}
