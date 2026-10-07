import SiteLink from "@/intro/components/SiteLink";

import { FloatingNav } from "@/intro/components/ui/floating-navbar";
import { useLocale, type Locale } from "@/intro/i18n";
import { LINKS, STORE_URL, BASE_PATH, docsPath } from "@/intro/site/config";
import { cn } from "@/lib/utils";

function StoreIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={cn("h-3.5 w-3.5", className)}>
      <path
        d="M3 9.5 4.5 4h15L21 9.5M3 9.5c0 1.4 1.1 2.5 2.5 2.5S8 10.9 8 9.5c0 1.4 1.1 2.5 2.5 2.5S13 10.9 13 9.5c0 1.4 1.1 2.5 2.5 2.5S18 10.9 18 9.5c0 1.4 1.1 2.5 2.5 2.5.17 0 .34-.02.5-.05M4.5 12.5V20h15v-7.55M9.5 20v-4.5h5V20"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function BookIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={cn("h-3.5 w-3.5", className)}>
      <path
        d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15.5H6.5A2.5 2.5 0 0 0 4 21V5.5Z M4 18.5A2.5 2.5 0 0 1 6.5 16H20"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        transform="translate(0 1)"
      />
    </svg>
  );
}

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={cn("h-4 w-4", className)}>
      <path
        fill="currentColor"
        d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.55 0-.27-.01-1.17-.02-2.12-3.2.7-3.88-1.36-3.88-1.36-.52-1.33-1.28-1.68-1.28-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.19 1.76 1.19 1.03 1.76 2.7 1.25 3.35.96.1-.75.4-1.25.72-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11.1 11.1 0 0 1 5.79 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.12 3.05.74.81 1.18 1.83 1.18 3.09 0 4.42-2.69 5.39-5.25 5.68.41.35.77 1.05.77 2.12 0 1.53-.01 2.76-.01 3.14 0 .3.2.67.8.55A11.51 11.51 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z"
      />
    </svg>
  );
}

const ANCHORS = [
  { key: "features", href: "#features" },
  { key: "surfaces", href: "#surfaces" },
  { key: "how", href: "#how" },
  { key: "plugins", href: "#plugins" },
  { key: "security", href: "#security" },
  { key: "faq", href: "#faq" },
] as const;

export function Navbar() {
  const { t, locale, setLocale } = useLocale();

  const items = ANCHORS.map(({ key, href }) => ({ name: t.nav[key], link: href }));
  const toggle: Locale = locale === "en" ? "zh-CN" : "en";

  return (
    <>
      {/* Static top bar (the floating pill takes over while scrolling up). */}
      <header className="absolute inset-x-0 top-0 z-[5001]">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-6 py-5">
          <SiteLink href="#top" className="flex items-center gap-2.5">
            <img
              src={`${BASE_PATH}/infinia-logo.svg`}
              alt="Infinia"
              width={32}
              height={32}
              className="h-8 w-8"
            />
            <span className="text-lg font-semibold tracking-tight text-white">
              {t.brand.name}
            </span>
            <span className="mt-0.5 hidden font-mono text-[11px] uppercase tracking-widest text-neutral-500 sm:block">
              {t.brand.tagline}
            </span>
          </SiteLink>

          <nav className="hidden items-center gap-1 lg:flex">
            {ANCHORS.map(({ key, href }) => (
              <SiteLink
                key={key}
                href={href}
                className="rounded-full px-3.5 py-1.5 text-sm text-neutral-400 transition-colors hover:bg-white/5 hover:text-white"
              >
                {t.nav[key]}
              </SiteLink>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <SiteLink
              href={docsPath(locale)}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/10 px-4 py-1.5 text-sm font-medium text-neutral-300 transition-colors hover:border-white/30 hover:text-white"
            >
              <BookIcon />
              {t.nav.docs}
            </SiteLink>
            <SiteLink
              href={STORE_URL}
              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-jb-green)]/40 bg-[var(--color-jb-green)]/10 px-4 py-1.5 text-sm font-medium text-[var(--color-jb-green)] transition-colors hover:border-[var(--color-jb-green)] hover:text-white"
            >
              <StoreIcon />
              {t.nav.store}
            </SiteLink>
            <button
              type="button"
              onClick={() => setLocale(toggle)}
              aria-label={t.nav.langSwitchAria}
              className="rounded-full border border-white/10 px-3.5 py-1.5 font-mono text-xs text-neutral-300 transition-colors hover:border-white/30 hover:text-white"
            >
              {t.nav.langSwitch}
            </button>
            <SiteLink
              href={LINKS.github}
              target="_blank"
              rel="noreferrer"
              aria-label="GitHub"
              className="hidden h-8 w-8 items-center justify-center rounded-full border border-white/10 text-neutral-300 transition-colors hover:border-white/30 hover:text-white"
            >
              <GitHubIcon />
            </SiteLink>
            <SiteLink
              href="#downloads"
              className="rounded-full bg-white px-4 py-1.5 text-sm font-semibold text-black transition-colors hover:bg-neutral-200"
            >
              {t.nav.download}
            </SiteLink>
          </div>
        </div>
      </header>

      {/* Aceternity floating navbar — slides in when scrolling back up. */}
      <FloatingNav
        navItems={[
          ...items,
          { name: t.nav.docs, link: docsPath(locale), icon: <BookIcon className="h-4 w-4" /> },
          { name: t.nav.store, link: STORE_URL, icon: <StoreIcon className="h-4 w-4" /> },
        ]}
        cta={{ label: t.nav.download, href: "#downloads" }}
      />
    </>
  );
}
