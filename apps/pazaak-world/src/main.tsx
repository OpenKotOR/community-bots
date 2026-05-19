import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AnimatedBackground } from './components/AnimatedBackground.tsx'
import { discordHubRoute } from './deployRoutes.ts'

const normalizedPath = window.location.pathname.replace(/\/+$/u, '') || '/'
const discordHubPath = discordHubRoute().replace(/\/+$/u, '') || '/'
const isDiscordBotsHubPath = normalizedPath === discordHubPath

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {!isDiscordBotsHubPath ? <AnimatedBackground /> : null}
    <div className="app-shell">
      <App />
    </div>
  </StrictMode>,
)
