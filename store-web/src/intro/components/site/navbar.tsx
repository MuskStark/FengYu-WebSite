import { useState } from "react";
import {
  Navbar as NavbarRoot,
  NavBody,
  NavItems,
  MobileNav,
  MobileNavHeader,
  MobileNavMenu,
  MobileNavToggle,
  NavbarButton,
} from "@/components/aceternity/resizable-navbar";
import SiteLink from "@/intro/components/SiteLink";
import { useLocale, type Locale } from "@/intro/i18n";
import { LINKS, STORE_URL } from "@/intro/site/config";
import { HexLogo } from "./brand";

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
  const [open, setOpen] = useState(false);
  const toggle: Locale = locale === "en" ? "zh-CN" : "en";

  const items = ANCHORS.map(({ key, href }) => ({ name: t.nav[key], link: href }));

  const langButton = (
    <NavbarButton
      as="button"
      variant="secondary"
      onClick={() => setLocale(toggle)}
      aria-label={t.nav.langSwitchAria}
      title={t.nav.langSwitchAria}
      className="font-mono text-xs"
    >
      {locale === "en" ? "中" : "EN"}
    </NavbarButton>
  );

  return (
    <div className="fixed inset-x-0 top-0 z-[5001]">
      <NavbarRoot className="top-2">
        <NavBody>
          <SiteLink href="#top" className="relative z-20 mr-4 flex items-center gap-2.5 px-2 py-1">
            <HexLogo className="size-7" />
            <span className="font-display text-sm font-semibold tracking-wide text-white">
              {t.brand.name}
              <span className="ml-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.2em] text-white/40">
                {t.brand.tagline}
              </span>
            </span>
          </SiteLink>
          <NavItems items={items} />
          <div className="relative z-20 flex items-center gap-2">
            {langButton}
            <NavbarButton
              href={LINKS.releases}
              target="_blank"
              rel="noreferrer"
              variant="secondary"
              className="text-sm"
            >
              {t.nav.download}
            </NavbarButton>
            <NavbarButton
              as="a"
              href={STORE_URL}
              className="bg-brand text-sm font-semibold text-[#18181b] hover:brightness-105"
            >
              {t.nav.store}
            </NavbarButton>
          </div>
        </NavBody>

        <MobileNav className="bg-black/40">
          <MobileNavHeader>
            <SiteLink href="#top" className="flex items-center gap-2.5">
              <HexLogo className="size-7" />
              <span className="font-display text-sm font-semibold text-white">{t.brand.name}</span>
            </SiteLink>
            <MobileNavToggle isOpen={open} onClick={() => setOpen(!open)} />
          </MobileNavHeader>
          <MobileNavMenu isOpen={open} onClose={() => setOpen(false)}>
            {items.map((item) => (
              <SiteLink
                key={item.link}
                href={item.link}
                onClick={() => setOpen(false)}
                className="text-sm text-neutral-300"
              >
                {item.name}
              </SiteLink>
            ))}
            <div className="flex w-full flex-col gap-3 pt-2">
              {langButton}
              <NavbarButton
                href={LINKS.releases}
                target="_blank"
                rel="noreferrer"
                variant="secondary"
              >
                {t.nav.download}
              </NavbarButton>
              <NavbarButton
                as="a"
                href={STORE_URL}
                className="bg-brand font-semibold text-[#18181b] hover:brightness-105"
              >
                {t.nav.store}
              </NavbarButton>
            </div>
          </MobileNavMenu>
        </MobileNav>
      </NavbarRoot>
    </div>
  );
}
