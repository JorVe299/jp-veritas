import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchJobs } from './api';
import Billboard from './components/Billboard';
import CitizenWall from './components/CitizenWall';
import InventoryManager from './components/InventoryManager';
import JobManager from './components/JobManager';
import MoneyManager from './components/MoneyManager';
import PlayerDataManager from './components/PlayerDataManager';
import VehicleManager from './components/VehicleManager';
import TopBar from './components/TopBar';
import { PlateSprite } from './components/Plate';
import { useRoster } from './lib/useRoster';
import { formatTime } from './utils/format';
import './App.css';

const LOG_LIMIT = 6;

function App() {
    const [search, setSearch] = useState('');
    const [page, setPage] = useState(1);
    const [selectedPlayer, setSelectedPlayer] = useState(null);
    // Wird nach jeder Mutation hochgezaehlt und laesst die Wand neu laden.
    const [rosterVersion, setRosterVersion] = useState(0);
    const [jobs, setJobs] = useState({});
    const [jobsError, setJobsError] = useState(null);
    // Abgeschlossene Schreibvorgaenge der laufenden Sitzung.
    const [writeLog, setWriteLog] = useState([]);

    const roster = useRoster(search, page, rosterVersion);
    const stageRef = useRef(null);

    // Job-Stammdaten einmal pro Sitzung laden, nicht bei jedem Wechsel.
    useEffect(() => {
        let cancelled = false;
        fetchJobs()
            .then((res) => { if (!cancelled) setJobs(res.data || {}); })
            .catch((err) => {
                if (!cancelled) setJobsError(err.response?.data?.error || err.message);
            });
        return () => { cancelled = true; };
    }, []);

    const handleSearchChange = useCallback((value) => {
        setSearch(value);
        setPage(1);
    }, []);

    // Auswahl bringt den Kopfbereich nach oben: nach dem Klick steht alles,
    // was geaendert werden kann, in einem Blickfeld.
    const handleSelect = useCallback((player) => {
        setSelectedPlayer(player);
        setWriteLog([]);
        stageRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    }, []);

    // Eine Mutation hat Erfolg gemeldet: ausgewaehlten Citizen sofort
    // aktualisieren, den Vorgang festhalten und die Wand nachziehen.
    const handleApplied = useCallback((patch, entry) => {
        setSelectedPlayer((prev) => (prev ? { ...prev, ...patch } : prev));
        setRosterVersion((v) => v + 1);
        if (entry) {
            setWriteLog((prev) => [
                { id: `${Date.now()}-${prev.length}`, time: formatTime(), ...entry },
                ...prev,
            ].slice(0, LOG_LIMIT));
        }
    }, []);

    const bridgeDown = Boolean(roster.bridge && !roster.bridge.reachable);

    return (
        <div className="app">
            <PlateSprite />

            <TopBar
                search={search}
                onSearchChange={handleSearchChange}
                bridge={roster.bridge}
                status={roster.status}
            />

            <div className="stage" ref={stageRef}>
                <Billboard
                    player={selectedPlayer}
                    bridgeDown={bridgeDown}
                    writeLog={writeLog}
                    onClear={() => setWriteLog([])}
                />

                {selectedPlayer && (
                    /* Modulraster: weitere Module (Inventar, Fahrzeuge, ...)
                       einfach hier ergaenzen, das Grid ordnet sie selbst ein.
                       key sorgt dafuer, dass die Formulare beim Wechsel des
                       Citizens neu starten - bei jedem Modul gleich anwenden. */
                    <div className="modules">
                        <JobManager
                            key={`job-${selectedPlayer.citizenid}`}
                            selectedPlayer={selectedPlayer}
                            jobs={jobs}
                            jobsError={jobsError}
                            onApplied={handleApplied}
                        />
                        <MoneyManager
                            key={`money-${selectedPlayer.citizenid}`}
                            selectedPlayer={selectedPlayer}
                            onApplied={handleApplied}
                        />
                        <InventoryManager
                            key={`inv-${selectedPlayer.citizenid}`}
                            selectedPlayer={selectedPlayer}
                            onApplied={handleApplied}
                        />
                        <VehicleManager
                            key={`veh-${selectedPlayer.citizenid}`}
                            selectedPlayer={selectedPlayer}
                            onApplied={handleApplied}
                        />
                        <PlayerDataManager
                            key={`data-${selectedPlayer.citizenid}`}
                            selectedPlayer={selectedPlayer}
                            onApplied={handleApplied}
                        />
                    </div>
                )}

                <div id="wall">
                    <CitizenWall
                        players={roster.players}
                        bridge={roster.bridge}
                        status={roster.status}
                        error={roster.error}
                        isStale={roster.isStale}
                        search={roster.query.search}
                        page={page}
                        onPageChange={setPage}
                        selectedId={selectedPlayer?.citizenid}
                        onSelect={handleSelect}
                    />
                </div>
            </div>
        </div>
    );
}

export default App;
