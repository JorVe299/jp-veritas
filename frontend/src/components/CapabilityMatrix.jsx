import { Fragment, useState } from 'react';
import Icon from './Icon';

/** Capability-by-role grid; a table, not a role picker: it is read to compare roles */
export default function CapabilityMatrix({
    roles,
    groups,
    draft,
    canEdit,
    saving,
    onToggle,
}) {
    // Tracks hidden, not shown, roles: a new role appears without being switched on
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
                                    className={`pill pill--drop pill--fit ${open ? '' : 'matrix__folded'}`.trim()}
                                    onClick={() => fold(role.id)}
                                    aria-pressed={open}
                                    title={role.label}
                                >
                                    <Icon name={open ? 'check' : 'plus'} size={13} className="pill__x" />
                                    <span className="u-clip">{role.label}</span>
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
                                                    /* A lone tick would pass for a control */
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
