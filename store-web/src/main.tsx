import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from 'next-themes';
import { BrowserRouter } from 'react-router';
import App from './App';
import { RouterTree } from './router';
import { setLocale } from './i18n';
import { i18n } from './i18n';
import './styles/main.css';

// Restore persisted locale before mount (theme restore is next-themes' job —
// it re-applies the stored light/dark choice from the same storage key the
// header toggle writes, before first paint, via its injected script).
// One-time migration: the marketplace now boots dark by default (Aceternity
// redesign), so drop the pre-redesign "light" choice users had persisted —
// the header toggle still allows switching back and persists normally after.
const THEME_MIGRATION_KEY = 'infinia.store.theme-migrated-to-dark';
if (!localStorage.getItem(THEME_MIGRATION_KEY)) {
  localStorage.removeItem('infinia.store.theme');
  localStorage.setItem(THEME_MIGRATION_KEY, '1');
}
setLocale(i18n.language as 'en' | 'zh-CN');

createRoot(document.getElementById('app')!).render(
  <StrictMode>
    <ThemeProvider
      attribute="class"
      storageKey="infinia.store.theme"
      defaultTheme="dark"
      enableSystem={false}
    >
      <BrowserRouter>
        <App>
          <RouterTree />
        </App>
      </BrowserRouter>
    </ThemeProvider>
  </StrictMode>,
);
