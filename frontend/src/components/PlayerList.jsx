import { useState, useEffect } from 'react';
import api from '../api';

export default function PlayerList({ onSelectPlayer }) {
    const [players, setPlayers] = useState([]);
    const [search, setSearch] = useState('');
    const [page, setPage] = useState(1);
    
    // Debounce Suche (Damit nicht bei jedem Tastenschlag gefetcht wird)
    useEffect(() => {
        // cancelled schützt vor Race Conditions: bei schnellem Tippen darf
        // eine langsamere ältere Antwort die neuere nicht überschreiben
        let cancelled = false;

        const timer = setTimeout(async () => {
            try {
                const res = await api.get('/players', {
                    params: { search, page, limit: 15 }
                });
                if (!cancelled) setPlayers(res.data);
            } catch (err) {
                if (!cancelled) console.error("Fehler beim Laden:", err);
            }
        }, 500);

        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [search, page]);

    return (
        <div className="player-list-container">
            {/* Suchleiste */}
            <input 
                type="text" 
                placeholder="Suche Name oder ID..." 
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                style={{ width: '100%', padding: '10px', marginBottom: '10px' }}
            />

            {/* Liste */}
            <div className="list-scroll">
                {players.map(p => (
                    <div 
                        key={p.citizenid} 
                        className={`player-card-item ${p.isOnline ? 'online' : ''}`}
                        onClick={() => onSelectPlayer(p)}
                    >
                        <div className="status-indicator"></div>
                        <div>
                            <strong>{p.name}</strong>
                            <div style={{ fontSize: '0.8em', color: '#aaa' }}>
                                {p.jobLabel} | ID: {p.citizenid}
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            {/* Pagination Buttons */}
            <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                <button disabled={page === 1} onClick={() => setPage(p => p - 1)}>Zurück</button>
                <button onClick={() => setPage(p => p + 1)}>Weiter</button>
            </div>
        </div>
    );
}