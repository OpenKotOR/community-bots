import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AnimatedBackground } from './components/AnimatedBackground.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AnimatedBackground />
    <App />
  </StrictMode>,
)
