import { useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from './stores/auth';
import { AppNavbar } from './components/AppNavbar';

/**
 * Marketplace shell: dark Aceternity navbar (components/AppNavbar.tsx) on top,
 * the routed view in the middle, themed footer band at the bottom. The intro
 * and the redesigned discover page carry their own footer; sign-in is bare.
 */
export default function App({ children }: { children: React.ReactNode }) {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  // The intro renders its own navbar/footer; the discover page carries its own
  // dark footer; sign-in is fully bare. Everything else gets the marketplace
  // chrome (dark Aceternity navbar + themed footer band).
  const showNavbar = !['/', '/store/signin'].includes(location.pathname);
  const showFooter = !['/', '/store', '/store/signin'].includes(location.pathname);
  const auth = useAuth();

  // Load the session once at boot; guards hold their route until auth.ready.
  useEffect(() => {
    if (!auth.ready) {
      void auth.load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex min-h-screen flex-col">
      {showNavbar && (
        <AppNavbar />
      )}

      <main className={showNavbar ? 'w-full flex-1 pt-24' : 'w-full flex-1'}>
        {children}
      </main>

      {/* Light-gray marketplace footer band: links left, brand right. */}
      {showFooter && (
        <footer className="border-t border-line bg-surface-muted">
          <div className="mx-auto flex max-w-[90rem] flex-wrap items-center justify-between gap-3 px-4 py-5 text-xs text-muted">
            <p>
              {t('common.footerTagline')}
              <span aria-hidden="true">·</span>
              <Link className="ml-1 text-accent hover:underline" to="/store/status">
                {t('nav.status')}
              </Link>
            </p>
            <Link to="/store" className="flex items-center gap-2">
              <img src="/infinia-logo.svg" alt="" className="h-6 w-6" />
              <span className="font-semibold text-ink">Infinia Store</span>
            </Link>
          </div>
        </footer>
      )}
    </div>
  );
}
