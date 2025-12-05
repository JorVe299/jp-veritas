import { useState } from 'react';
import JobManager from './components/JobManager';
import './App.css'; // Standard CSS

function App() {
    // Dummy Spieler Daten (Bis wir die Player-List API fertig haben)
    // Später kommt das aus einer <PlayerList /> Komponente
    const [selectedPlayer, setSelectedPlayer] = useState({
        citizenid: 'QB-123456',
        charinfo: { firstname: 'Max', lastname: 'Mustermann' },
        job: { name: 'police', grade: 1 }
    });

    return (
        <div className="app-container">
            <header>
                <h1>FiveM Admin Panel</h1>
            </header>
            
            <div className="content-grid">
                {/* Linke Seite: Spieler Liste (Platzhalter) */}
                <aside className="sidebar">
                    <h3>Spieler Liste</h3>
                    <div 
                        className="player-card active"
                        onClick={() => console.log("Spieler gewählt")}
                    >
                        {selectedPlayer.charinfo.firstname} (Online)
                    </div>
                </aside>

                {/* Rechte Seite: Detailansicht */}
                <main className="details">
                    <JobManager selectedPlayer={selectedPlayer} />
                    
                    {/* Hier können später VehicleManager, InventoryManager hin */}
                </main>
            </div>
        </div>
    );
}

export default App;