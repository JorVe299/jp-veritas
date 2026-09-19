// src/api.js
import axios from 'axios';

// Relativ: im Dev übernimmt der Vite-Proxy (siehe vite.config.js),
// im Build liegt das Frontend hinter derselben Origin wie die API.
const api = axios.create({
    baseURL: '/api',
});

// Helper Funktionen
export const fetchPlayers = (params) => api.get('/players', { params });
export const fetchJobs = () => api.get('/meta/jobs');
export const updatePlayerJob = (citizenid, jobData) => api.post('/manage/job', { citizenid, ...jobData });
export const updatePlayerMoney = (citizenid, amount, type) => api.post('/manage/money', { citizenid, amount, type });

export default api;
