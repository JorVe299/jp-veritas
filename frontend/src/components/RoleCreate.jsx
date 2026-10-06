import { useState } from 'react';
import { MAX_LABEL, cleanLabel, idFromLabel, roleIdProblem } from '../lib/roleEditing';

/**
 * New-role form: only the name is required; the id derives from it unless typed
 * The final id is shown before saving: it lands in sessions and the JSON file, immutable
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

    // Hint only: the server judges label clashes against every role
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
                        ? `Limit of ${maxRoles} roles reached.`
                        : `${roles.length} of ${maxRoles} roles.`}
                </span>
            </div>
        );
    }

    return (
        <div className="roster__new">
            <p className="field__hint">Grants nothing until Discord accounts or a role are mapped to it.</p>

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
