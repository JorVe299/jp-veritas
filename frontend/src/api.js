// src/api.js
import axios from 'axios';

// Basis-Konfiguration für dein Node.js Backend
const api = axios.create({
    baseURL: 'http://localhost:3001/api', // Dein Backend Port
});

// Helper Funktionen
export const fetchPlayers = () => api.get('/players'); // Müssen wir im Backend noch bauen
export const fetchJobs = () => api.get('/meta/jobs');  // Die Route haben wir vorhin gebaut
export const updatePlayerJob = (citizenid, jobData) => api.post('/manage/job', { citizenid, ...jobData });

export default api;