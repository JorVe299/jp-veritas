import { useState } from 'react';
import Icon from './Icon';
import { MAX_IDS, MAX_LABEL, cleanLabel, sameIds, snowflakeProblem } from '../lib/roleEditing';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * One role in the ranking.
 *
 * The row reads on its own - rank, name, id, how much it may do and who
 * holds it - and opens into the form that changes the name and the Discord
 * mapping. Capabilities are not in here: they are ticked in the grid below,
 * where a role can be compared with the others, and they are saved in bulk.
 * Everything this row does takes effect the moment its button is pressed.
 */
export default function RoleRow({
    role,
    rank,
    total,
    canEdit,
    busy,
    count,
    dirty,
    onMove,
    onSave,
    onDelete,
}) {
    const [open, setOpen] = useState(false);
    const [label, setLabel] = useState(role.label);
    const [users, setUsers] = useState(() => [...(role.discordUserIds || [])]);
    const [groups, setGroups] = useState(() => [...(role.discordRoleIds || [])]);
    const [confirming, setConfirming] = useState(false);
    const [working, setWorking] = useState(false);

    // Absent, not empty: for anyone who may not edit, the server leaves both
    // lists out of the answer rather than sending []. Showing "nobody is
    // mapped" there would be an invention.
    const mappingKnown = Array.isArray(role.discordUserIds);
    const mapped = mappingKnown ? role.discordUserIds.length + role.discordRoleIds.length : 0;

    const trimmed = cleanLabel(label);
    const renamed = trimmed !== role.label;
    const remapped = mappingKnown
        && (!sameIds(users, role.discordUserIds) || !sameIds(groups, role.discordRoleIds));
    const changed = (renamed && trimmed.length > 0) || remapped;
    const held = busy !== null || working;

    const discard = () => {
        setLabel(role.label);
        setUsers([...(role.discordUserIds || [])]);
        setGroups([...(role.discordRoleIds || [])]);
    };

    const save = async () => {
        if (!changed || held) return;
        setWorking(true);
        const patch = {};
        if (renamed) patch.label = trimmed;
        if (remapped) {
            patch.discordUserIds = users;
            patch.discordRoleIds = groups;
        }
        const ok = await onSave(role.id, patch);
        setWorking(false);
        if (ok) setOpen(false);
    };

    const remove = async () => {
        setWorking(true);
        const ok = await onDelete(role.id);
        setWorking(false);
        if (!ok) setConfirming(false);
    };

    return (
        <li className="line role">
            <div className="line__top">
                <span className="role__rank u-mono" aria-hidden="true">{rank}</span>
                <span className="line__name">{role.label}</span>
                <span className="line__slot u-mono">{role.id}</span>

                <span className="line__badges">
                    {role.locked && <span className="pill pill--unknown">Locked</span>}
                    {role.builtIn && !role.locked && <span className="pill pill--off">Shipped</span>}
                    <span className="pill pill--off">
                        {role.locked ? 'All rights' : plural(count, 'right')}
                        {dirty ? ' · unsaved' : ''}
                    </span>
                </span>
            </div>

            <div className="line__meta">
                <span className="u-sr">{`Rank ${rank} of ${total}.`}</span>

                {role.locked && (
                    /* Said once, here, where somebody would otherwise go
                       looking for the controls that are missing. */
                    <span>
                        The owner cannot be re-permissioned or removed: it holds every
                        right, which is what stops a panel from locking its own owner
                        out. Its name can be changed.
                    </span>
                )}

                {!role.locked && mappingKnown && (
                    mapped === 0
                        ? <span>Nobody is mapped to it, so it grants nothing to anyone yet.</span>
                        : (
                            <span>
                                {`${plural(role.discordUserIds.length, 'account')}, `}
                                {`${plural(role.discordRoleIds.length, 'Discord role')} mapped.`}
                            </span>
                        )
                )}

                {!mappingKnown && (
                    <span>Who holds this role is shown to the owner only.</span>
                )}

                {confirming && (
                    <span className="role__warn">
                        {`Removing ${role.label} takes effect at once and reaches backwards: `}
                        everyone who holds it loses access immediately, including sessions
                        that are already open — nobody is signed out, they simply may
                        nothing any more.
                        {mapped > 0 ? ` ${plural(mapped, 'Discord mapping')} go with it.` : ''}
                        {' '}
                        What it was allowed to do goes with it too.
                    </span>
                )}
            </div>

            <div className="line__actions">
                {!role.locked && canEdit && (
                    <>
                        <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            onClick={() => onMove(role.id, -1)}
                            /* Rank 1 is the owner and does not move, so rank 2
                               has nowhere left to go. */
                            disabled={held || rank <= 2}
                        >
                            Move up
                        </button>
                        <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            onClick={() => onMove(role.id, 1)}
                            disabled={held || rank >= total}
                        >
                            Move down
                        </button>
                    </>
                )}

                {canEdit && (
                    <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() => {
                            if (open) discard();
                            setOpen(!open);
                            setConfirming(false);
                        }}
                        disabled={held}
                        aria-expanded={open}
                    >
                        {open ? 'Close' : (role.locked ? 'Rename' : 'Rename and mapping')}
                    </button>
                )}

                {canEdit && !role.locked && (
                    confirming ? (
                        <>
                            <button
                                type="button"
                                className="btn btn--danger btn--sm"
                                onClick={remove}
                                disabled={held}
                            >
                                {working ? 'Removing…' : `Really delete ${role.label}`}
                            </button>
                            <button
                                type="button"
                                className="btn btn--ghost btn--sm"
                                onClick={() => setConfirming(false)}
                                disabled={working}
                            >
                                Keep it
                            </button>
                        </>
                    ) : (
                        <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            onClick={() => { setConfirming(true); setOpen(false); }}
                            disabled={held}
                        >
                            Delete
                        </button>
                    )
                )}
            </div>

            {open && canEdit && (
                <div className="role__edit">
                    <label className="field">
                        <span className="field__label">Name</span>
                        <input
                            className="input"
                            value={label}
                            maxLength={MAX_LABEL}
                            onChange={(e) => setLabel(e.target.value)}
                            disabled={held}
                        />
                        <span className="field__hint">
                            {trimmed.length === 0
                                ? 'A role needs a name.'
                                : `The id (${role.id}) stays as it is — it sits in sessions that are already signed in.`}
                        </span>
                    </label>

                    {mappingKnown ? (
                        <>
                            <IdList
                                title="Discord accounts"
                                hint="Individual accounts that hold this role."
                                ids={users}
                                disabled={held}
                                onChange={setUsers}
                            />
                            <IdList
                                title="Discord roles"
                                hint="Everyone carrying this role on the Discord server holds it."
                                ids={groups}
                                disabled={held}
                                onChange={setGroups}
                            />

                            <p className="field__hint">
                                This mapping is what actually grants the role. Without an entry
                                here it is a set of rights that nobody holds.
                            </p>

                            {role.builtIn && (
                                /* Quietly, but said: the file can grant this
                                   role in ways the panel cannot even see. */
                                <p className="field__hint">
                                    A role shipped with the panel can also be mapped in the
                                    server&apos;s .env file. Those entries are not listed here and
                                    cannot be changed from here, so this may not be everyone who
                                    holds it. They keep working — and they are the way back in if
                                    this list is ever wrong.
                                </p>
                            )}
                        </>
                    ) : (
                        <p className="field__hint">
                            The Discord mapping is sent to nobody but the owner, so it cannot
                            be shown here.
                        </p>
                    )}

                    <div className="line__actions">
                        <button
                            type="button"
                            className="btn btn--primary btn--sm"
                            onClick={save}
                            disabled={!changed || held}
                        >
                            {working ? 'Saving…' : 'Save role'}
                        </button>
                        <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            onClick={discard}
                            disabled={!changed || held}
                        >
                            Discard
                        </button>
                    </div>
                </div>
            )}
        </li>
    );
}

/**
 * One of the two id lists.
 *
 * Every id is a chip that can be taken off again, and a new one is checked
 * before it is added. The server would take a username in without
 * complaining and drop it on the way to disk - which looks exactly like a
 * permission that was never granted, and is the hardest kind of mistake to
 * find afterwards.
 */
function IdList({ title, hint, ids, disabled, onChange }) {
    const [entry, setEntry] = useState('');
    const [problem, setProblem] = useState(null);

    const add = () => {
        const value = entry.trim();
        const wrong = snowflakeProblem(value);
        if (wrong) {
            setProblem(wrong);
            return;
        }
        if (ids.includes(value)) {
            setProblem('That id is already in this list.');
            return;
        }
        if (ids.length >= MAX_IDS) {
            setProblem(`A list holds at most ${MAX_IDS} ids.`);
            return;
        }
        setProblem(null);
        setEntry('');
        onChange([...ids, value]);
    };

    return (
        <div className="field">
            <span className="field__label">{title}</span>

            {ids.length > 0 && (
                <div className="role__chips">
                    {ids.map((id) => (
                        <button
                            key={id}
                            type="button"
                            className="pill pill--drop u-mono"
                            onClick={() => onChange(ids.filter((kept) => kept !== id))}
                            disabled={disabled}
                            aria-label={`Remove ${id} from ${title}`}
                        >
                            {id}
                            <Icon name="cross" size={12} className="pill__x" />
                        </button>
                    ))}
                </div>
            )}

            <div className="role__add">
                <input
                    className="input"
                    value={entry}
                    inputMode="numeric"
                    placeholder="e.g. 356712004581392385"
                    onChange={(e) => { setEntry(e.target.value); setProblem(null); }}
                    onKeyDown={(e) => {
                        // Enter adds the id. This sits inside no form on
                        // purpose - a stray Enter must not save the role.
                        if (e.key === 'Enter') { e.preventDefault(); add(); }
                    }}
                    disabled={disabled}
                    aria-label={`Add an id to ${title}`}
                />
                <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={add}
                    disabled={disabled || entry.trim().length === 0}
                >
                    Add
                </button>
            </div>

            <span className={`field__hint ${problem ? 'role__problem' : ''}`.trim()}>
                {problem || `${hint} ${ids.length === 0 ? 'None yet.' : plural(ids.length, 'id')}`}
            </span>
        </div>
    );
}
