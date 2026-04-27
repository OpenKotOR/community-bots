import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

const apiOrigin = 'http://localhost:4001'

const defaultOauthProviders = {
  providers: [
    { provider: 'google', enabled: false },
    { provider: 'discord', enabled: false },
    { provider: 'github', enabled: false },
  ],
}

async function proxyOrFallback(path: string, init: RequestInit, fallback: Response): Promise<Response> {
  try {
    return await fetch(`${apiOrigin}${path}`, {
      ...init,
      signal: AbortSignal.timeout(750),
    })
  } catch {
    return fallback
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'pazaak-world-dev-api-fallbacks',
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          const method = req.method ?? 'GET'
          const requestUrl = req.url ?? ''
          const { pathname, search } = new URL(requestUrl, 'http://localhost')

          if (pathname === '/api/ping' && (method === 'GET' || method === 'HEAD')) {
            const response = await proxyOrFallback(`${pathname}${search}`, { method }, new Response(null, { status: 204 }))
            res.statusCode = response.status
            res.end()
            return
          }

          if (pathname === '/api/auth/oauth/providers' && method === 'GET') {
            const response = await proxyOrFallback(
              pathname,
              { method },
              new Response(JSON.stringify(defaultOauthProviders), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
              }),
            )
            res.statusCode = response.status
            res.setHeader('Content-Type', response.headers.get('Content-Type') ?? 'application/json')
            res.end(await response.text())
            return
          }

          next()
        })
      },
    },
  ],
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

