import { useState } from 'react';
import JobManager from './components/JobManager';
import PlayerList from './components/PlayerList';
import './App.css';

function App() {
    const [selectedPlayer, setSelectedPlayer] = useState(null);

    return (
        <div className="app-container">
            <header>
                <h1>FiveM Admin Panel</h1>
            </header>
            
            <div className="content-grid">
                {/* Linke Seite: Echte Liste */}
                <aside className="sidebar">
                    <PlayerList onSelectPlayer={setSelectedPlayer} />
                </aside>

                {/* Rechte Seite: Details */}
                <main className="details">
                    {selectedPlayer ? (
                        <>
                            <h2>Verwaltung: {selectedPlayer.name}</h2>
                            <div className="status-badge">
                                Status: {selectedPlayer.isOnline ? '🟢 ONLINE' : '🔴 OFFLINE'}
                            </div>
                            
                            {/* Deine Module */}
                            {/* key sorgt dafür, dass die Formulare bei Spielerwechsel neu starten */}
                            <JobManager key={selectedPlayer.citizenid} selectedPlayer={selectedPlayer} />
                            
                            {/* Platzhalter für Inventar / Fahrzeuge */}
                            {/* <InventoryManager selectedPlayer={selectedPlayer} /> */}
                        </>
                    ) : (
                        <div className="empty-state">
                            Wähle einen Spieler aus der Liste links.
                        </div>
                    )}
                </main>
            </div>
        </div>
    );
}

export default App;