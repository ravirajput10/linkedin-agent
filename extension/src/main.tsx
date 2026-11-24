import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Detect whether running inside Chrome extension popup or full webpage
const isExtension = window.location.protocol === 'chrome-extension:' || !window.location.host;
if (!isExtension) {
  document.documentElement.classList.remove('is-extension-popup');
  document.documentElement.classList.add('is-webpage-tab');
} else {
  document.documentElement.classList.add('is-extension-popup');
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
