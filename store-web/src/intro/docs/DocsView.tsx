import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useLocation, useParams } from "react-router";

import SiteLink from "@/intro/components/SiteLink";
import { useLocale } from "@/intro/i18n";
import { LINKS, STORE_URL, BASE_PATH } from "@/intro/site/config";
import { setLocale } from "@/i18n";
import { cn } from "@/lib/utils";

import { docsManifest, loadPage, normalizeSlug, pageTitle, type DocsLocale, type DocsPage } from "./content";
import { slugifyHeading } from "./links";
import { pageNeighbors, sidebarFor } from "./tree";
import { Markdown } from "./Markdown";
import "./docs.css";

type UiLocale = "en" | "zh-CN";

const toDocsLocale = (locale: UiLocale): DocsLocale => (locale === "zh-CN" ? "zh" : "en");
const toUiLocale = (locale: DocsLocale): UiLocale => (locale === "zh" ? "zh-CN" : "en");

/** /docs without a locale lands on the persisted language's home page. */
export function DocsEntryRedirect() {
  const { locale } = useLocale();
  return <Navigate to={`/docs/${toDocsLocale(locale)}/index`} replace />;
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

interface TocEntry {
  depth: 2 | 3;
  text: string;
  id: string;
}

/** h2/h3 lines outside fenced code blocks, with ids matching the renderer's slugify. */
function extractToc(markdown: string): TocEntry[] {
  const entries: TocEntry[] = [];
  let inFence = false;
  for (const line of markdown.split("\n")) {
    if (/^(```|~~~)/.test(line.trim())) inFence = !inFence;
    if (inFence) continue;
    const match = /^(#{2,3})\s+(.+?)\s*#*$/.exec(line);
    if (match) {
      const text = match[2].trim();
      entries.push({ depth: match[1].length as 2 | 3, text, id: slugifyHeading(text) });
    }
  }
  return entries;
}

function useDocsLocaleSlug(): { docsLocale: DocsLocale; slug: string; localeSegMissing: boolean } {
  const splat = useParams()["*"] ?? "";
  const [first, ...rest] = splat.split("/").filter(Boolean);
  if (first !== "en" && first !== "zh") {
    return { docsLocale: "en", slug: normalizeSlug(splat), localeSegMissing: true };
  }
  return { docsLocale: first, slug: normalizeSlug(rest.join("/")), localeSegMissing: false };
}

export default function DocsView() {
  const { t } = useLocale();
  const { hash } = useLocation();
  const { docsLocale, slug, localeSegMissing } = useDocsLocaleSlug();
  const uiLocale = toUiLocale(docsLocale);
  const [page, setPage] = useState<DocsPage | null | undefined>(undefined);
  const [filter, setFilter] = useState("");

  // The URL locale wins on docs pages and is persisted, so leaving /docs keeps
  // the language the reader chose.
  useEffect(() => {
    setLocale(uiLocale);
  }, [uiLocale]);

  useEffect(() => {
    let cancelled = false;
    setPage(undefined);
    loadPage(docsLocale, slug).then((loaded) => {
      if (!cancelled) setPage(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [docsLocale, slug]);

  // Same-page anchors need the async content in the DOM before scrolling.
  useEffect(() => {
    if (page === undefined) return;
    if (hash) {
      const target = document.getElementById(decodeURIComponent(hash.slice(1)));
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
    } else {
      window.scrollTo(0, 0);
    }
  }, [page, hash]);

  // Tab/history title mirrors the page, like the intro view's <title> handling.
  useEffect(() => {
    const previous = document.title;
    document.title = `${pageTitle(docsLocale, slug)} · ${t.brand.name} ${t.docs.title}`;
    return () => {
      document.title = previous;
    };
  }, [docsLocale, slug, t]);

  const groups = useMemo(() => sidebarFor(docsLocale, uiLocale, filter), [docsLocale, uiLocale, filter]);
  const toc = useMemo(() => (page ? extractToc(page.markdown) : []), [page]);
  const { prev, next } = pageNeighbors(docsLocale, slug);
  const editUrl = `${LINKS.github}/edit/${docsManifest.sourceRef}/docs/${docsLocale}/${slug}.md`;
  const togglePath = `/docs/${docsLocale === "zh" ? "en" : "zh"}/${slug}`;

  if (localeSegMissing) {
    return <Navigate to={`/docs/${docsLocale}/${slug}`} replace />;
  }

  const sidebarNav = (
    <nav aria-label="Docs" className="flex flex-col gap-5">
      {groups.map((group) => (
        <div key={group.key}>
          <h3 className="px-3 font-mono text-[11px] uppercase tracking-widest text-neutral-600">{group.label}</h3>
          <ul className="mt-2 flex flex-col gap-0.5">
            {group.items.map((item) => (
              <li key={item.slug}>
                <SiteLink
                  href={`/docs/${docsLocale}/${item.slug}`}
                  aria-current={item.slug === slug ? "page" : undefined}
                  className="docs-sidebar-item"
                >
                  {item.title}
                </SiteLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {groups.length === 0 && (
        <p className="px-3 text-sm text-neutral-600">{t.docs.noMatches}</p>
      )}
    </nav>
  );

  return (
    <div className="docs-page flex min-h-screen w-full flex-col">
      <header className="sticky top-0 z-40 border-b border-white/10 bg-black/80 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-[1440px] items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <SiteLink href="/" className="flex shrink-0 items-center gap-2.5">
              <img
                src={`${BASE_PATH}/infinia-logo.svg`}
                alt="Infinia"
                width={28}
                height={28}
                className="h-7 w-7"
              />
              <span className="hidden font-semibold tracking-tight text-white sm:block">{t.brand.name}</span>
            </SiteLink>
            <span className="hidden text-neutral-600 sm:block" aria-hidden="true">/</span>
            <span className="truncate text-sm font-medium text-neutral-300">{t.docs.title}</span>
          </div>
          <div className="flex items-center gap-2">
            <SiteLink
              href={STORE_URL}
              className="hidden items-center gap-1.5 rounded-full border border-[var(--color-jb-green)]/40 bg-[var(--color-jb-green)]/10 px-3.5 py-1.5 text-sm font-medium text-[var(--color-jb-green)] transition-colors hover:border-[var(--color-jb-green)] hover:text-white sm:inline-flex"
            >
              {t.nav.store}
            </SiteLink>
            <Link
              to={togglePath}
              aria-label={t.nav.langSwitchAria}
              className="rounded-full border border-white/10 px-3 py-1.5 font-mono text-xs text-neutral-300 transition-colors hover:border-white/30 hover:text-white"
            >
              {t.nav.langSwitch}
            </Link>
            <a
              href={LINKS.github}
              target="_blank"
              rel="noreferrer"
              aria-label="GitHub"
              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/10 text-neutral-300 transition-colors hover:border-white/30 hover:text-white"
            >
              <GitHubIcon />
            </a>
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-[1440px] flex-1 items-start px-0 sm:px-6">
        {/* Desktop sidebar */}
        <aside className="sticky top-14 hidden max-h-[calc(100vh-3.5rem)] w-64 shrink-0 overflow-y-auto py-8 pr-6 lg:block">
          <input
            type="search"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder={t.docs.searchPlaceholder}
            className="mb-5 w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-white/25 focus:outline-none"
          />
          {sidebarNav}
        </aside>

        <main className="min-w-0 flex-1 py-8 lg:py-10">
          {/* Mobile doc browser */}
          <details className="mb-6 rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3 lg:hidden">
            <summary className="cursor-pointer list-none text-sm font-medium text-neutral-200">
              {t.docs.menu} — {pageTitle(docsLocale, slug)}
            </summary>
            <div className="mt-4">
              <input
                type="search"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder={t.docs.searchPlaceholder}
                className="mb-4 w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-white/25 focus:outline-none"
              />
              {sidebarNav}
            </div>
          </details>

          <article className="docs-article mx-auto max-w-3xl px-4 sm:px-6 lg:px-10">
            {page === undefined && (
              <div aria-busy="true" className="flex flex-col gap-4">
                <div className="h-9 w-2/3 animate-pulse rounded-lg bg-white/5" />
                <div className="h-4 w-full animate-pulse rounded bg-white/5" />
                <div className="h-4 w-5/6 animate-pulse rounded bg-white/5" />
                <div className="h-4 w-4/6 animate-pulse rounded bg-white/5" />
              </div>
            )}
            {page === null && (
              <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-10 text-center">
                <p className="text-lg font-semibold text-white">{t.docs.notFound}</p>
                <p className="mt-2 text-sm text-neutral-400">{t.docs.notFoundHint}</p>
                <SiteLink
                  href={`/docs/${docsLocale}/index`}
                  className="mt-6 inline-block rounded-full bg-white px-5 py-2 text-sm font-semibold text-black transition-colors hover:bg-neutral-200"
                >
                  {t.docs.backHome}
                </SiteLink>
              </div>
            )}
            {page && <Markdown markdown={page.markdown} locale={docsLocale} slug={page.slug} />}

            {(prev || next) && (
              <div className="mt-14 flex items-stretch justify-between gap-4 border-t border-white/10 pt-6">
                {prev ? (
                  <SiteLink
                    href={`/docs/${docsLocale}/${prev}`}
                    className="group flex min-w-0 flex-col rounded-xl border border-white/10 px-4 py-3 transition-colors hover:border-white/25"
                  >
                    <span className="font-mono text-[11px] uppercase tracking-widest text-neutral-600">
                      {t.docs.prev}
                    </span>
                    <span className="mt-1 truncate text-sm font-medium text-neutral-200 group-hover:text-white">
                      {pageTitle(docsLocale, prev)}
                    </span>
                  </SiteLink>
                ) : (
                  <span />
                )}
                {next && (
                  <SiteLink
                    href={`/docs/${docsLocale}/${next}`}
                    className="group flex min-w-0 flex-col items-end rounded-xl border border-white/10 px-4 py-3 text-right transition-colors hover:border-white/25"
                  >
                    <span className="font-mono text-[11px] uppercase tracking-widest text-neutral-600">
                      {t.docs.next}
                    </span>
                    <span className="mt-1 truncate text-sm font-medium text-neutral-200 group-hover:text-white">
                      {pageTitle(docsLocale, next)}
                    </span>
                  </SiteLink>
                )}
              </div>
            )}

            <p className="mt-8 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-white/5 pt-6 font-mono text-[11px] text-neutral-600">
              <span>{t.docs.syncedFrom(docsManifest.sourceRef)}</span>
              <span aria-hidden="true">·</span>
              <a href={editUrl} target="_blank" rel="noreferrer" className="underline-offset-2 hover:text-neutral-400 hover:underline">
                {t.docs.editPage}
              </a>
            </p>
          </article>
        </main>

        {/* On-this-page TOC */}
        {toc.length > 0 && (
          <nav
            aria-label={t.docs.onThisPage}
            className="sticky top-14 hidden max-h-[calc(100vh-3.5rem)] w-56 shrink-0 overflow-y-auto py-10 pl-6 xl:block"
          >
            <h3 className="font-mono text-[11px] uppercase tracking-widest text-neutral-600">
              {t.docs.onThisPage}
            </h3>
            <ul className="mt-3 flex flex-col gap-2 border-l border-white/10">
              {toc.map((entry) => (
                <li key={entry.id} className={entry.depth === 3 ? "pl-4" : "pl-0"}>
                  <a
                    href={`#${entry.id}`}
                    className={cn(
                      "-ml-px block border-l border-transparent text-[13px] leading-snug text-neutral-500 transition-colors hover:border-white/40 hover:text-neutral-200",
                      entry.depth === 3 && "text-neutral-600",
                    )}
                  >
                    {entry.text}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </div>
    </div>
  );
}
