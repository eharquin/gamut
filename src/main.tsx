import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { clearMeasuresPeriodically } from './developmentMeasures'

// React's development build fills the performance timeline (#371).
if (import.meta.env.DEV) clearMeasuresPeriodically()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
