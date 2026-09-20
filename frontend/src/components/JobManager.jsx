import { useState } from 'react';
import Icon from './Icon';
import StatusNote from './StatusNote';
import { updatePlayerJob } from '../api';
import { jobTitle } from '../utils/format';

// Hinweis: App.jsx gibt diesem Component ein key={citizenid}. Dadurch wird es
// bei Wechsel des Citizens neu gemountet und der State unten startet
// automatisch mit dessen Job - kein Sync-Effect noetig.
export default function JobManager({ selectedPlayer, jobs, jobsError, onApplied }) {
    const [selectedJob, setSelectedJob] = useState(selectedPlayer?.job?.name || '');
    const [selectedGrade, setSelectedGrade] = useState(String(selectedPlayer?.job?.grade?.level ?? '0'));
    const [saving, setSaving] = useState(false);
    const [feedback, setFeedback] = useState(null);

    const jobList = jobs || {};
    const currentJob = jobList[selectedJob];
    const gradeEntries = currentJob ? Object.entries(currentJob.grades || {}) : [];

    // Abgeleitet statt synchronisiert: faellt der gespeicherte Rang aus der
    // Liste des gewaehlten Jobs, greift der erste verfuegbare Rang.
    const gradeValue = currentJob && currentJob.grades?.[selectedGrade]
        ? selectedGrade
        : (gradeEntries[0]?.[0] ?? '');

    const originalJob = selectedPlayer?.job?.name || '';
    const originalGrade = String(selectedPlayer?.job?.grade?.level ?? '0');
    const isDirty = selectedJob !== originalJob || gradeValue !== originalGrade;
    const canSave = Boolean(selectedJob) && isDirty && !saving;
    const jobCount = Object.keys(jobList).length;

    const handleJobChange = (e) => {
        const next = e.target.value;
        setSelectedJob(next);
        // Rang auf den ersten Eintrag des neuen Jobs zuruecksetzen
        setSelectedGrade(Object.keys(jobList[next]?.grades || {})[0] ?? '0');
        setFeedback(null);
    };

    const handleSave = async () => {
        if (!selectedJob) {
            setFeedback({ tone: 'error', title: 'Choose a job first.' });
            return;
        }

        setSaving(true);
        setFeedback(null);
        try {
            const res = await updatePlayerJob(selectedPlayer.citizenid, {
                jobName: selectedJob,
                gradeLevel: gradeValue,
            });

            const grade = currentJob?.grades?.[gradeValue];
            const label = currentJob?.label ?? selectedJob;
            const gradeName = grade?.name ?? gradeValue;
            const mode = res.data.mode === 'live' ? 'live' : 'offline';

            setFeedback({
                tone: 'success',
                title: `Job set to ${label} — ${gradeName}`,
                detail: mode === 'live'
                    ? 'Applied live on the server.'
                    : 'This citizen is not connected, so the change was written to the database.',
            });

            // Kopfbereich und Wand sofort auf den neuen Stand bringen
            onApplied?.(
                {
                    job: {
                        name: selectedJob,
                        label,
                        grade: { name: gradeName, level: Number(gradeValue) },
                    },
                },
                { mode, text: `Job set to ${label} · ${gradeName}` },
            );
        } catch (err) {
            setFeedback({
                tone: 'error',
                title: 'Could not save the job',
                detail: err.response?.data?.error || err.message,
            });
        } finally {
            setSaving(false);
        }
    };

    return (
        <section className="panel" aria-labelledby="job-panel-title">
            <header className="panel__head">
                <Icon name="briefcase" size={18} className="panel__icon" />
                <div>
                    <h2 className="panel__title" id="job-panel-title">Employment</h2>
                    <p className="panel__hint">Currently {jobTitle(selectedPlayer)}</p>
                </div>
            </header>

            <div className="panel__body">
                {jobsError && (
                    <StatusNote
                        tone="error"
                        title="The job list could not be loaded"
                        detail={jobsError}
                    />
                )}

                <div className="field">
                    <label className="field__label" htmlFor="job-select">Employer</label>
                    <select
                        id="job-select"
                        className="select"
                        value={selectedJob}
                        onChange={handleJobChange}
                        disabled={saving || jobCount === 0}
                    >
                        <option value="">— Choose a job —</option>
                        {Object.entries(jobList).map(([key, job]) => (
                            <option key={key} value={key}>
                                {job.label} ({key})
                            </option>
                        ))}
                    </select>
                </div>

                {/* Die Rangleiter zeigt alle Stufen dieses Jobs auf einmal und
                    hebt die gewaehlte hervor, statt sie in einer Klappliste zu
                    verstecken. Der Abstand zwischen zwei Raengen ist damit
                    sichtbar, nicht nur der Rang selbst. */}
                <div className="field">
                    <span className="field__label" id="grade-label">Rank</span>
                    {gradeEntries.length === 0 ? (
                        <p className="field__hint">Choose a job to see its ranks.</p>
                    ) : (
                        <div className="ladder" role="radiogroup" aria-labelledby="grade-label">
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
                                        disabled={saving}
                                    >
                                        <span className="ladder__level u-mono">{level}</span>
                                        <span className="ladder__name">{grade.name}</span>
                                        {level === originalGrade && selectedJob === originalJob && (
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
                    onClick={handleSave}
                    disabled={!canSave}
                >
                    {saving ? 'Saving…' : 'Apply job'}
                </button>
            </footer>
        </section>
    );
}
