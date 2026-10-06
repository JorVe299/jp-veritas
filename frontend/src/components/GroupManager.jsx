import { useState } from 'react';
import Icon from './Icon';
import PermissionLine from './PermissionLine';
import StatusNote from './StatusNote';
import { fetchPlayerGroups, removePlayerGroup, setPlayerGroup } from '../api';
import { useCan } from '../lib/useCan';
import { usePlayerResource } from '../lib/usePlayerResource';
import { failureNote, modeOf, successNote } from '../lib/writeFeedback';

// player_groups mixes jobs and gangs; this card touches gang rows only
const TYPE = 'gang';

/** Gang memberships: unlike a job a citizen can hold several, each left on its own row */
export default function GroupManager({ selectedPlayer, gangs, gangsError, onApplied }) {
    const { can } = useCan();
    const canEdit = can('groups.edit');

    const citizenid = selectedPlayer?.citizenid;
    const [version, setVersion] = useState(0);
    const [selectedGang, setSelectedGang] = useState('');
    const [selectedGrade, setSelectedGrade] = useState('0');
    const [saving, setSaving] = useState(false);
    const [feedback, setFeedback] = useState(null);

    const res = usePlayerResource(fetchPlayerGroups, citizenid, version);

    // The route returns jobs too; those belong to the Employment card
    const rows = Array.isArray(res.data?.groups) ? res.data.groups : [];
    const memberships = rows.filter((group) => group.type === TYPE);

    const gangList = gangs || {};
    const currentGang = gangList[selectedGang];
    const gradeEntries = currentGang ? Object.entries(currentGang.grades || {}) : [];
    const gangCount = Object.keys(gangList).length;

    // Derived, not synced: a rank missing from the chosen gang falls back to its first
    const gradeValue = currentGang && currentGang.grades?.[selectedGrade]
        ? selectedGrade
        : (gradeEntries[0]?.[0] ?? '');

    // Decides add vs rank move, and where the ladder marks "Now"
    const held = memberships.find((group) => group.name === selectedGang);
    const originalGrade = held ? String(held.grade ?? 0) : null;

    const blocked = res.status === 'unavailable' || res.status === 'error';
    const isDirty = Boolean(selectedGang) && (!held || gradeValue !== originalGrade);
    const canSave = Boolean(selectedGang) && isDirty && !saving && canEdit && !blocked;

    const reload = () => setVersion((v) => v + 1);
    const report = (mode, text) => onApplied?.({}, { mode, text });

    const handleGangChange = (e) => {
        const next = e.target.value;
        setSelectedGang(next);
        setSelectedGrade(Object.keys(gangList[next]?.grades || {})[0] ?? '0');
        setFeedback(null);
    };

    const handleApply = async () => {
        if (!selectedGang) {
            setFeedback({ tone: 'error', title: 'Choose a gang first.' });
            return;
        }

        setSaving(true);
        setFeedback(null);
        try {
            // Type fixed, never from the UI: this card can never touch a job row
            const answer = await setPlayerGroup(citizenid, {
                group: selectedGang,
                type: TYPE,
                grade: Number(gradeValue),
            });

            const label = currentGang?.label ?? selectedGang;
            const gradeName = currentGang?.grades?.[gradeValue]?.name ?? gradeValue;

            setFeedback(successNote(answer, `Gang set to ${label} — ${gradeName}`));
            report(modeOf(answer) ?? 'offline', `${held ? 'Rank' : 'Gang'} set to ${label} · ${gradeName}`);
            reload();
        } catch (err) {
            setFeedback(failureNote('Could not save the gang', err));
        } finally {
            setSaving(false);
        }
    };

    return (
        <section className="panel" aria-labelledby="gang-panel-title">
            <header className="panel__head">
                <Icon name="users" size={18} className="panel__icon" />
                <div>
                    <h2 className="panel__title" id="gang-panel-title">Gang membership</h2>
                    <p className="panel__hint">{headHint(res, memberships)}</p>
                </div>
            </header>

            <div className="panel__body">
                {!canEdit && <PermissionLine what="change gangs or ranks" />}

                {res.status === 'unavailable' && (
                    <StatusNote
                        tone="warn"
                        title="Gang memberships are not available in this schema"
                        detail={[res.error, res.hint].filter(Boolean).join(' ')}
                    />
                )}

                {res.status === 'error' && (
                    <StatusNote
                        tone="error"
                        title="The gang memberships could not be loaded"
                        detail={res.error}
                    />
                )}

                {memberships.length > 0 && (
                    <ul className={`lines${memberships.length > 4 ? ' lines--scroll' : ''}`}>
                        {memberships.map((group) => (
                            <GangRow
                                key={group.name}
                                citizenid={citizenid}
                                group={group}
                                canEdit={canEdit}
                                onFeedback={setFeedback}
                                onChanged={reload}
                                onReport={report}
                            />
                        ))}
                    </ul>
                )}
            </div>

            <div className="panel__body">
                {gangsError && (
                    <StatusNote
                        tone="error"
                        title="The gang list could not be loaded"
                        detail={gangsError}
                    />
                )}

                <div className="field">
                    <label className="field__label" htmlFor="gang-select">Gang</label>
                    <select
                        id="gang-select"
                        className="select"
                        value={selectedGang}
                        onChange={handleGangChange}
                        disabled={saving || gangCount === 0 || !canEdit || blocked}
                    >
                        <option value="">— Choose a gang —</option>
                        {Object.entries(gangList).map(([key, gang]) => (
                            <option key={key} value={key}>
                                {gang.label} ({key})
                            </option>
                        ))}
                    </select>
                    {held && (
                        <span className="field__hint">
                            Already on record — applying moves the rank.
                        </span>
                    )}
                </div>

                {/* Ladder, not a dropdown: shows the distance between ranks */}
                <div className="field">
                    <span className="field__label" id="gang-grade-label">Rank</span>
                    {gradeEntries.length === 0 ? (
                        <p className="field__hint">Choose a gang to see its ranks.</p>
                    ) : (
                        <div className="ladder" role="radiogroup" aria-labelledby="gang-grade-label">
                            {gradeEntries.map(([level, grade]) => {
                                const active = level === gradeValue;
                                return (
                                    <button
                                        key={level}
                                        type="button"
                                        role="radio"
                                        aria-checked={active}
                                        className={`ladder__step${active ? ' is-active' : ''}`}
                                        onClick={() => { setSelectedGrade(level); setFeedback(null); }}
                                        disabled={saving || !canEdit || blocked}
                                    >
                                        <span className="ladder__level u-mono">{level}</span>
                                        <span className="ladder__name" title={grade.name}>{grade.name}</span>
                                        {level === originalGrade && (
                                            <span className="ladder__now u-caps">Now</span>
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>

                {feedback && (
                    <StatusNote tone={feedback.tone} title={feedback.title} detail={feedback.detail} />
                )}
            </div>

            <footer className="panel__foot">
                <span className="panel__footinfo">
                    {isDirty ? 'Unsaved change' : 'No change'}
                </span>
                <button
                    type="button"
                    className="btn btn--primary"
                    onClick={handleApply}
                    disabled={!canSave}
                >
                    {saving ? 'Saving…' : 'Apply gang'}
                </button>
            </footer>
        </section>
    );
}

// Same shape as the Employment card's "Currently ..." line
function headHint(res, memberships) {
    if (res.status === 'loading') return 'Reading the gang list';
    if (res.status === 'unavailable') return 'Module unavailable';
    if (res.status === 'error') return 'Gangs unknown';
    if (memberships.length === 0) return 'Currently in no gang';
    if (memberships.length === 1) {
        const only = memberships[0];
        const label = only.label || only.name;
        return `Currently ${label}${only.gradeName ? ` — ${only.gradeName}` : ''}`;
    }
    return `Currently in ${memberships.length} gangs`;
}

// --- Gang row -------------------------------------------------------------

// Rank changes go through the form, as for jobs; the row only offers leaving
function GangRow({ citizenid, group, canEdit, onFeedback, onChanged, onReport }) {
    const [confirming, setConfirming] = useState(false);
    const [busy, setBusy] = useState(false);

    const known = group.known !== false;
    const label = group.label || group.name;

    const remove = async () => {
        setBusy(true);
        onFeedback(null);
        try {
            // Type sent with the delete too: never a same-named job row
            const answer = await removePlayerGroup(citizenid, group.name, TYPE);
            onFeedback(successNote(answer, `${label} removed`));
            onReport(modeOf(answer) ?? 'offline', `Left ${label}`);
            onChanged();
        } catch (err) {
            setConfirming(false);
            onFeedback(failureNote('The gang membership could not be removed', err));
        } finally {
            setBusy(false);
        }
    };

    return (
        <li className="line">
            <div className="line__top">
                <span className="line__name">{label}</span>
                <span className="line__slot u-mono">{group.name}</span>
                {!known && <span className="pill pill--unknown line__badge">Orphaned</span>}
            </div>

            <div className="line__meta">
                <span>
                    Grade {group.grade ?? 0}
                    {group.gradeName ? ` · ${group.gradeName}` : ''}
                </span>
                {!known && (
                    <span>
                        No longer in the server data
                    </span>
                )}
                {confirming && <span>Removes the citizen from this gang.</span>}
            </div>

            <div className="line__actions">
                {confirming ? (
                    <>
                        <button
                            type="button"
                            className="btn btn--danger btn--sm"
                            onClick={remove}
                            disabled={busy || !canEdit}
                        >
                            {busy ? 'Removing…' : 'Really remove'}
                        </button>
                        <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            onClick={() => setConfirming(false)}
                            disabled={busy}
                        >
                            Keep
                        </button>
                    </>
                ) : (
                    <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() => { setConfirming(true); onFeedback(null); }}
                        disabled={busy || !canEdit}
                    >
                        Remove
                    </button>
                )}
            </div>
        </li>
    );
}
