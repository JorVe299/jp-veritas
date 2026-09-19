import { useState, useEffect } from 'react';
import { fetchJobs, updatePlayerJob } from '../api';

// Hinweis: App.jsx gibt diesem Component ein key={citizenid}. Dadurch wird es
// bei Spielerwechsel neu gemountet und der State unten startet automatisch mit
// dem Job des neuen Spielers - kein Sync-Effect nötig.
export default function JobManager({ selectedPlayer }) {
    const [jobs, setJobs] = useState({});
    const [selectedJob, setSelectedJob] = useState(selectedPlayer?.job?.name || '');
    const [selectedGrade, setSelectedGrade] = useState(String(selectedPlayer?.job?.grade?.level ?? '0'));
    const [loading, setLoading] = useState(false);

    // Lade die Job-Liste beim Start
    useEffect(() => {
        fetchJobs().then(res => setJobs(res.data));
    }, []);

    // Wenn kein Spieler ausgewählt ist, zeige nichts
    if (!selectedPlayer) return <div className="p-4">Bitte Wähle einen Spieler aus.</div>;

    const handleSave = async () => {
        if (!selectedJob) return alert('Bitte zuerst einen Job wählen.');

        setLoading(true);
        try {
            const res = await updatePlayerJob(selectedPlayer.citizenid, {
                jobName: selectedJob,
                gradeLevel: selectedGrade
            });
            alert(`Job gespeichert (${res.data.mode === 'live' ? 'live auf dem Server' : 'offline in der DB'})!`);
        } catch (err) {
            alert('Fehler beim Speichern: ' + (err.response?.data?.error || err.message));
        }
        setLoading(false);
    };

    return (
        <div className="card">
            <h3>Job Verwaltung für {selectedPlayer.name}</h3>
            
            {/* JOB AUSWAHL */}
            <div className="form-group">
                <label>Job:</label>
                <select 
                    value={selectedJob} 
                    onChange={(e) => {
                        setSelectedJob(e.target.value);
                        setSelectedGrade('0'); // Reset Grade bei Jobwechsel
                    }}
                >
                    <option value="">-- Wähle Job --</option>
                    {/* Object.entries wandelt das JSON-Objekt in ein Array um für .map() */}
                    {Object.entries(jobs).map(([key, job]) => (
                        <option key={key} value={key}>
                            {job.label} ({key})
                        </option>
                    ))}
                </select>
            </div>

            {/* GRADE AUSWAHL (Nur wenn Job gewählt) */}
            {selectedJob && jobs[selectedJob] && (
                <div className="form-group">
                    <label>Rang (Grade):</label>
                    <select 
                        value={selectedGrade} 
                        onChange={(e) => setSelectedGrade(e.target.value)}
                    >
                        {Object.entries(jobs[selectedJob].grades).map(([level, grade]) => (
                            <option key={level} value={level}>
                                {level} - {grade.name}
                            </option>
                        ))}
                    </select>
                </div>
            )}

            <button onClick={handleSave} disabled={loading}>
                {loading ? 'Speichere...' : 'Änderungen übernehmen'}
            </button>
        </div>
    );
}