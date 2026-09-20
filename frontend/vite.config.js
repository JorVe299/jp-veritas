import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Leitet /api im Dev an das Node Backend weiter.
    // Dadurch ist die Frontend-Origin gleich der API-Origin -> kein CORS,
    // und später funktionieren Session-Cookies ohne Sonderbehandlung.
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  // `npm run preview` ist ein eigener Server und erbt server.proxy NICHT.
  // Ohne das hier laufen im Preview alle /api Aufrufe ins Leere.
  // Für echten Betrieb trotzdem nicht preview nutzen, sondern den Build
  // vom Backend ausliefern lassen (siehe server.js).
  preview: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
