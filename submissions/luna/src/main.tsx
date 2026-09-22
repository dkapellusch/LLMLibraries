import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

const root = document.getElementById('root')

if (!root) {
  throw new Error('Luna Library could not find the root element.')
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
