import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
    base: process.env.BASE || '/',
  resolve: {
    alias: {
      '@openkotor/pazaak-engine/menu-preset': fileURLToPath(new URL('../../packages/pazaak-engine/dist/menu-preset.js', import.meta.url)),
      '@openkotor/pazaak-engine/opponents': fileURLToPath(new URL('../../packages/pazaak-engine/dist/opponents.js', import.meta.url)),
    },
  },
  server: {
    proxy: {
      // Proxy /api and /ws to the local pazaak-bot API server during development.
      '/api': {
        target: 'http://localhost:4001',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:4001',
        ws: true,
        changeOrigin: true,
      },
    },
  },
})

