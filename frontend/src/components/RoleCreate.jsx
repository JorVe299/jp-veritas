import { useState } from 'react';
import { MAX_LABEL, cleanLabel, idFromLabel, roleIdProblem } from '../lib/roleEditing';

/**
 * Making a role.
 *
 * Two fields and a choice, and only the first field is required. The id is
 * derived from the name unless one is typed, and the form shows which id
 * that will be - it ends up in sessions and in the JSON file and cannot be
 * changed afterwards, so it should not be a surprise.
 *
 * Copying sits in the middle because it is the common case: a second
 * support team is the first one plus or minus a little, and starting from
 * an empty grid means ticking twenty boxes and getting one of them wrong.
 */
export default function RoleCreate({ roles, maxRoles, busy, onCreate }) {
    const [open, setOpen] = useState(false);
    const [label, setLabel] = useState('');
    const [id, setId] = useState('');
    const [copyFrom, setCopyFrom] = useState('');
    const [working, setWorking] = useState(false);

    const full = roles.length >= maxRoles;
    const trimmed = cleanLabel(label);
    const idTrouble = roleIdProblem(id);
    const derived = trimmed ? idFromLabel(trimmed) : '';
    const willBe = id.trim() || derived;

    // The label clash is the server's to judge - it compares against every
    // role, this only catches the one that is plainly visible.
    const taken = roles.some((role) => role.label.toLowerCase() === trimmed.toLowerCase());
    const idTaken = willBe ? roles.some((role) => role.id === willBe) : false;

    const ready = trimmed.length > 0 && !idTrouble && !taken && !idTaken && !full;

    const reset = () => {
        setLabel('');
        setId('');
        setCopyFrom('');
    };

    const submit = async () => {
        if (!ready || working || busy !== null) return;
        setWorking(true);
        const body = { label: trimmed };
        if (id.trim()) body.id = id.trim();
        if (copyFrom) body.copyFrom = copyFrom;
        const ok = await onCreate(body);
        setWorking(false);
        if (ok) {
            reset();
            setOpen(false);
        }
    };

    if (!open) {
        return (
            <div className="roster__foot">
                <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => setOpen(true)}
                    disabled={full || busy !== null}
                >
                    New role
                </button>
                <span className="field__hint">
                    {full
                        ? `This panel holds the most roles it can (${maxRoles}). Remove one before adding another.`
                        : `${roles.length} of ${maxRoles} roles.`}
                </span>
            </div>
        );
    }

    return (
        <div className="roster__new">
            <p className="field__hint">
                A new role grants nothing until somebody is mapped to it. Name it here,
                tick what it may do in the grid below, then open it and add the Discord
                accounts or the Discord role that should hold it — otherwise the team
                will be wondering why they still cannot sign in.
            </p>

            <div className="roster__fields">
                <label className="field">
                    <span className="field__label">Name</span>
                    <input
                        className="input"
                        value={label}
                        maxLength={MAX_LABEL}
                        placeholder="Vehicle Team"
                        onChange={(e) => setLabel(e.target.value)}
                        disabled={working}
                    />
                    <span className="field__hint">
                        {taken
                            ? 'There is already a role with that name.'
                            : 'What the role is called in the panel and in the ranking.'}
                    </span>
                </label>

                <label className="field">
                    <span className="field__label">Id (optional)</span>
                    <input
                        className="input u-mono"
                        value={id}
                        placeholder={derived || 'vehicle-team'}
                        onChange={(e) => setId(e.target.value)}
                        disabled={working}
                    />
                    <span className="field__hint">
                        {idTrouble
                            || (idTaken ? `There is already a role with the id '${willBe}'.` : null)
                            || (willBe
                                ? `It will be saved as '${willBe}' and cannot be changed later.`
                                : 'Left empty it is derived from the name.')}
                    </span>
                </label>

                <label className="field">
                    <span className="field__label">Start from</span>
                    <select
                        className="select"
                        value={copyFrom}
                        onChange={(e) => setCopyFrom(e.target.value)}
                        disabled={working}
                    >
                        <option value="">Nothing — grant every right by hand</option>
                        {roles.map((role) => (
                            <option key={role.id} value={role.id}>
                                {`${role.label} (${role.capabilityCount} rights)`}
                            </option>
                        ))}
                    </select>
                    <span className="field__hint">
                        Copies that role&apos;s rights into the new one. Nothing else travels
                        with it — the copy holds no Discord mapping and grants nobody
                        anything until it gets one.
                    </span>
                </label>
            </div>

            <div className="line__actions">
                <button
                    type="button"
                    className="btn btn--primary btn--sm"
                    onClick={submit}
                    disabled={!ready || working || busy !== null}
                >
                    {working ? 'Creating…' : 'Create role'}
                </button>
                <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => { reset(); setOpen(false); }}
                    disabled={working}
                >
                    Cancel
                </button>
            </div>
        </div>
    );
}
