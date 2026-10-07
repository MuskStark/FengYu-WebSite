import SiteLink from "@/intro/components/SiteLink";

import { useLocale, type Locale } from "@/intro/i18n";
import { LINKS, STORE_URL, BASE_PATH, docsPath } from "@/intro/site/config";

/** Docs links are locale-aware in-app routes; the rest stay outbound. */
function linkMap(locale: Locale): Record<string, string> {
  return {
    DOCS: docsPath(locale),
    AGENT: docsPath(locale, "guide/ai-agent"),
    PLUGINS: docsPath(locale, "plugins/overview"),
    ARCH: docsPath(locale, "architecture/overview"),
    CHANGELOG: LINKS.changelog,
    GITHUB: LINKS.github,
    RELEASES: LINKS.releases,
    ISSUES: LINKS.issues,
    STORE: STORE_URL,
  };
}

function FooterColumn({
  title,
  links,
  resolved,
}: {
  title: string;
  links: { label: string; href: string }[];
  resolved: Record<string, string>;
}) {
  return (
    <div>
      <h3 className="font-mono text-xs uppercase tracking-widest text-neutral-500">
        {title}
      </h3>
      <ul className="mt-4 flex flex-col gap-2.5">
        {links.map((link) => (
          <li key={link.label}>
            <SiteLink
              href={resolved[link.href] ?? link.href}
              {...(resolved[link.href]?.startsWith("http")
                ? { target: "_blank", rel: "noreferrer" }
                : {})}
              className="text-sm text-neutral-400 transition-colors hover:text-white"
            >
              {link.label}
            </SiteLink>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Footer() {
  const { t, locale } = useLocale();
  const resolved = linkMap(locale);

  return (
    <footer className="relative z-10 w-full border-t border-white/10 bg-black">
      <div className="mx-auto grid max-w-7xl gap-12 px-6 py-16 md:grid-cols-[1.6fr_1fr_1fr_1fr]">
        <div>
          <div className="flex items-center gap-2.5">
            <img
              src={`${BASE_PATH}/infinia-logo.svg`}
              alt="Infinia"
              width={28}
              height={28}
              className="h-7 w-7"
            />
            <span className="text-lg font-semibold text-white">{t.brand.name}</span>
            <span className="font-mono text-[10px] uppercase tracking-widest text-neutral-500">
              {t.brand.tagline}
            </span>
          </div>
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-neutral-500">
            {t.footer.blurb}
          </p>
        </div>
        <FooterColumn title={t.footer.productTitle} links={t.footer.product} resolved={resolved} />
        <FooterColumn title={t.footer.resourcesTitle} links={t.footer.resources} resolved={resolved} />
        <FooterColumn title={t.footer.ecosystemTitle} links={t.footer.ecosystem} resolved={resolved} />
      </div>
      <div className="border-t border-white/5">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-6 py-6 text-xs text-neutral-600 md:flex-row md:items-center md:justify-between">
          <span>{t.footer.legal}</span>
          <span className="font-mono">{t.footer.rights}</span>
        </div>
      </div>
    </footer>
  );
}
