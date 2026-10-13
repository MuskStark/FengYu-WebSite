import SiteLink from "@/intro/components/SiteLink";
import { useLocale } from "@/intro/i18n";
import { LINKS, STORE_URL } from "@/intro/site/config";
import { HexLogo } from "./brand";

const EXTERNAL: Record<string, string> = {
  DOCS: LINKS.docs,
  AGENT: LINKS.docsAgent,
  PLUGINS: LINKS.docsPlugins,
  ARCH: LINKS.docsArchitecture,
  CHANGELOG: LINKS.changelog,
  GITHUB: LINKS.github,
  RELEASES: LINKS.releases,
  ISSUES: LINKS.issues,
  STORE: STORE_URL,
};

function FooterColumn({
  title,
  links,
}: {
  title: string;
  links: { label: string; href: string }[];
}) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-white">{title}</h3>
      <ul className="mt-4 flex flex-col gap-2.5">
        {links.map((link) => {
          const href = EXTERNAL[link.href] ?? link.href;
          return (
            <li key={link.label}>
              <SiteLink
                href={href}
                {...(href.startsWith("http") ? { target: "_blank", rel: "noreferrer" } : {})}
                className="text-sm text-white/45 transition-colors hover:text-white"
              >
                {link.label}
              </SiteLink>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function Footer() {
  const { t } = useLocale();
  return (
    <footer className="border-t border-white/10 bg-black">
      <div className="mx-auto grid max-w-7xl gap-10 px-6 py-14 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div>
          <div className="flex items-center gap-2.5">
            <HexLogo className="size-7" />
            <span className="font-display text-sm font-semibold text-white">
              {t.brand.name} · {t.brand.tagline}
            </span>
          </div>
          <p className="mt-4 max-w-xs text-sm leading-6 text-white/45">{t.footer.blurb}</p>
          <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.2em] text-white/30">
            127.0.0.1:24056 · GPL-3.0
          </p>
        </div>
        <FooterColumn title={t.footer.productTitle} links={t.footer.product} />
        <FooterColumn title={t.footer.resourcesTitle} links={t.footer.resources} />
        <FooterColumn title={t.footer.ecosystemTitle} links={t.footer.ecosystem} />
      </div>
      <div className="border-t border-white/5 px-6 py-5 text-center">
        <p className="text-xs text-white/35">{t.footer.legal}</p>
        <p className="mt-1 text-xs text-white/35">{t.footer.rights}</p>
      </div>
    </footer>
  );
}
