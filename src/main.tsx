import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import './ui/theme/app.css';
import { App } from './App';
import { useStore } from './state/store';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Nur im Entwicklungsmodus: Store für Fehlersuche und E2E-Tests erreichbar machen
if (import.meta.env.DEV) (window as unknown as { __marktplanerStore: typeof useStore }).__marktplanerStore = useStore;
