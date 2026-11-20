import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { api } from './lib/api';
import { installCrashCapture } from './lib/crash-capture';
import './styles/index.css';

installCrashCapture(api.crash.report);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
