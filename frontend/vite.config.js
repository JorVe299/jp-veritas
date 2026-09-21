import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Forwards /api to the Node backend during development.
    // That makes the frontend origin the same as the API origin -> no CORS,
    // and session cookies work later on without special handling.
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  // `npm run preview` is a server of its own and does NOT inherit server.proxy.
  // Without this, every /api call in preview goes nowhere.
  // For real operation still do not use preview; let the backend serve the
  // build instead (see server.js).
  preview: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
