import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { useTheme } from 'next-themes';
import { useTranslation } from 'react-i18next';
import {
  Navbar as NavbarRoot,
  NavBody,
  NavItems,
  MobileNav,
  MobileNavHeader,
  MobileNavMenu,
  MobileNavToggle,
  NavbarButton,
} from '@/components/aceternity/resizable-navbar';
import AccountNotch from '@/components/AccountNotch';
import { useAuth } from '../stores/auth';
import { setLocale } from '../i18n';

/**
 * Marketplace-wide dark Aceternity navbar. Replaces the old themed shell
 * header on every page except the intro (which has its own) and sign-in
 * (bare). Carries the production nav set (auth-gated entries included), the
 * global search, language + theme toggles and the account notch.
 */
export function AppNavbar() {
  const { t, i18n } = useTranslation();
  const auth = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { resolvedTheme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Close the mobile sheet whenever the route changes.
  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  const isDark = resolvedTheme === 'dark';
  const isPublisher = auth.roles.some((r) =>
    ['PUBLISHER', 'ORG_ADMIN', 'REVIEWER', 'PLATFORM_ADMIN'].includes(r),
  );
  const isStaff = auth.roles.some((r) => ['REVIEWER', 'PLATFORM_ADMIN'].includes(r));
  const isAdmin = auth.roles.includes('PLATFORM_ADMIN');

  // On the discover page "browse" scrolls to the full catalog; anywhere else
  // it routes to the advanced browse tool.
  const onDiscover = location.pathname === '/store';
  const browseLink = onDiscover ? '#catalog' : '/store/browse';

  const items = [
    { name: t('nav.introduction'), link: '/' },
    { name: t('nav.discover'), link: '/store' },
    { name: t('nav.browse'), link: browseLink },
    ...(auth.isAuthenticated ? [{ name: t('nav.library'), link: '/store/library' }] : []),
    ...(isPublisher ? [{ name: t('nav.publisher'), link: '/store/publisher' }] : []),
    ...(isStaff ? [{ name: t('nav.review'), link: '/store/review' }] : []),
    ...(isAdmin ? [{ name: t('nav.admin'), link: '/store/admin' }] : []),
  ];

  // Hash targets scroll smoothly in place; same-origin paths go through the
  // SPA router so the dark shell never flashes the light chrome.
  const handleNavClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    const href = e.currentTarget.getAttribute('href');
    e.preventDefault();
    if (href && href.startsWith('#')) {
      document.getElementById(href.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else if (href && href.startsWith('/') && !href.startsWith('//')) {
      navigate(href);
    }
    setOpen(false);
  };

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    navigate({ pathname: '/store/browse', search: searchQuery ? `?q=${encodeURIComponent(searchQuery)}` : '' });
  };

  const toggleLocale = () => setLocale(i18n.language === 'en' ? 'zh-CN' : 'en');
  const toggleTheme = () => setTheme(isDark ? 'light' : 'dark');
  const initial = (auth.user?.displayName ?? auth.user?.email ?? '?').charAt(0).toUpperCase();

  const searchBox = (
    <form onSubmit={submitSearch} className="hidden xl:block" role="search">
      <label className="sr-only" htmlFor="app-navbar-search">
        {t('common.search')}
      </label>
      <input
        id="app-navbar-search"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        type="search"
        placeholder={t('common.search')}
        className="h-9 w-40 min-w-0 rounded-full border border-white/15 bg-white/5 px-4 text-sm text-white placeholder:text-white/35 focus:border-jb-purple/60 focus:outline-none"
      />
    </form>
  );

  const rightControls = (
    <>
      {searchBox}
      <NavbarButton
        as="button"
        variant="secondary"
        onClick={toggleLocale}
        aria-label={t('common.language')}
        title={t('common.language')}
        className="font-mono text-xs"
      >
        {i18n.language === 'en' ? '中' : 'EN'}
      </NavbarButton>
      <NavbarButton
        as="button"
        variant="secondary"
        onClick={toggleTheme}
        aria-label={t('common.theme')}
        title={t('common.theme')}
        className="text-sm"
      >
        {isDark ? '☀' : '☾'}
      </NavbarButton>
    </>
  );

  const accountControl = auth.isAuthenticated ? (
    <AccountNotch
      ghostClosed
      label={t('nav.account')}
      trigger={
        <>
          <span className="grid size-7 shrink-0 place-items-center rounded-lg border border-white/20 bg-white/10 text-xs font-bold text-white">
            {initial}
          </span>
          <span className="hidden min-w-0 flex-1 truncate text-left text-white md:block">
            {auth.user?.displayName}
          </span>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="shrink-0 text-white/50">
            <path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </>
      }
      options={[
        { id: '/store/account', label: t('nav.account') },
        { id: '/store/library', label: t('nav.library') },
        { id: '/store/organizations', label: t('nav.organizations') },
        ...(isPublisher ? [{ id: '/store/publisher', label: t('nav.publisher') }] : []),
        ...(isAdmin ? [{ id: '/store/admin', label: t('nav.admin') }] : []),
        { id: 'signout', label: t('nav.signOut'), danger: true },
      ]}
      onSelect={(id) => {
        if (id === 'signout') {
          auth.signOut();
          navigate('/store');
        } else {
          navigate(id);
        }
      }}
    />
  ) : (
    <NavbarButton
      as="button"
      onClick={(e: React.MouseEvent) => {
        e.preventDefault();
        navigate('/store/signin');
      }}
      className="bg-brand text-sm font-semibold text-[#18181b] hover:brightness-105"
    >
      {t('nav.signIn')}
    </NavbarButton>
  );

  return (
    <div className="fixed inset-x-0 top-0 z-50">
      <NavbarRoot className="top-2">
        <NavBody>
          <Link to="/store" className="relative z-20 mr-4 flex shrink-0 items-center gap-2.5 px-2 py-1">
            <img src="/infinia-logo.svg" alt="" className="size-7" />
            <span className="font-display text-sm font-semibold tracking-wide text-white">
              Infinia
              <span className="ml-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.2em] text-white/40">
                Store
              </span>
            </span>
          </Link>
          {/* Flow-participating center items: the vendored absolute centering
              collides with the search box once auth-gated items appear. */}
          <NavItems items={items} onItemClick={handleNavClick} className="relative inset-auto" />
          <div className="relative z-20 flex items-center gap-2">
            {rightControls}
            {accountControl}
          </div>
        </NavBody>

        <MobileNav className="bg-black/40">
          <MobileNavHeader>
            <Link to="/store" className="flex items-center gap-2.5">
              <img src="/infinia-logo.svg" alt="" className="size-7" />
              <span className="font-display text-sm font-semibold text-white">Infinia Store</span>
            </Link>
            <MobileNavToggle isOpen={open} onClick={() => setOpen(!open)} />
          </MobileNavHeader>
          <MobileNavMenu isOpen={open} onClose={() => setOpen(false)}>
            <form onSubmit={submitSearch} className="w-full" role="search">
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                type="search"
                placeholder={t('common.search')}
                aria-label={t('common.search')}
                className="h-10 w-full rounded-full border border-white/15 bg-white/5 px-4 text-sm text-white placeholder:text-white/35 focus:border-jb-purple/60 focus:outline-none"
              />
            </form>
            {items.map((item) =>
              item.link.startsWith('#') ? (
                <button
                  key={item.link}
                  onClick={() => {
                    setOpen(false);
                    document.getElementById(item.link.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }}
                  className="text-sm text-neutral-300"
                >
                  {item.name}
                </button>
              ) : (
                <Link
                  key={item.link}
                  to={item.link}
                  onClick={() => setOpen(false)}
                  className="text-sm text-neutral-300"
                >
                  {item.name}
                </Link>
              ),
            )}
            <div className="flex w-full flex-col gap-3 pt-2">
              <div className="flex gap-3">
                <NavbarButton as="button" variant="secondary" onClick={toggleLocale} className="flex-1 font-mono text-xs">
                  {i18n.language === 'en' ? '中文' : 'English'}
                </NavbarButton>
                <NavbarButton as="button" variant="secondary" onClick={toggleTheme} className="flex-1 text-sm">
                  {isDark ? '☀ Light' : '☾ Dark'}
                </NavbarButton>
              </div>
              {!auth.isAuthenticated && (
                <NavbarButton
                  as="button"
                  onClick={() => navigate('/store/signin')}
                  className="bg-brand font-semibold text-[#18181b] hover:brightness-105"
                >
                  {t('nav.signIn')}
                </NavbarButton>
              )}
            </div>
          </MobileNavMenu>
        </MobileNav>
      </NavbarRoot>
    </div>
  );
}
