import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'

// Build metadata: app version comes from package.json — the single source of
// truth for analytics (never hardcoded in application code).
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    proxy: {
      '/ws/realtime': { target: 'ws://localhost:3000', ws: true },
      '/api':         { target: 'http://localhost:3000' },
      '/chat':        { target: 'http://localhost:3000' },
      '/token':       { target: 'http://localhost:3000' },
      '/health':      { target: 'http://localhost:3000' },
    },
  },
})
