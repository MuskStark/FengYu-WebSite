import SiteLink from "@/intro/components/SiteLink";

import { Spotlight } from "@/intro/components/ui/spotlight";
import { Meteors } from "@/intro/components/ui/meteors";
import { Button as MovingBorderButton } from "@/intro/components/ui/moving-border";
import { FlipWords } from "@/intro/components/ui/flip-words";
import { useLocale } from "@/intro/i18n";
import { LINKS, STORE_URL, docsPath } from "@/intro/site/config";

function ArrowDownIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path
        d="M12 5v14m0 0-6-6m6 6 6-6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Hero() {
  const { t, locale } = useLocale();

  return (
    <section
      id="top"
      className="relative flex min-h-screen w-full flex-col items-center justify-center overflow-hidden pt-28"
    >
      {/* Aceternity spotlight + grid backdrop */}
      <div className="pointer-events-none absolute inset-0 bg-grid-white [mask-image:linear-gradient(to_bottom,black_20%,transparent_85%)]" />
      <Spotlight
        className="-left-10 -top-40 h-[90%] md:-left-60 md:-top-20"
        fill="#a73afd"
      />
      <Spotlight
        className="left-[110%] top-[10%] h-[80%] md:left-[80%]"
        fill="#0b70f5"
      />

      {/* A few meteors keep the hero alive without stealing the show */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]">
        <Meteors number={10} />
      </div>

      <div className="relative z-10 mx-auto flex w-full max-w-5xl flex-col items-center px-6 text-center">
        <span className="mb-8 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 font-mono text-xs text-neutral-300 backdrop-blur">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--color-jb-green)] opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--color-jb-green)]" />
          </span>
          {t.hero.badge}
        </span>

        <h1 className="text-balance text-4xl font-bold leading-[1.08] tracking-tight text-white sm:text-6xl md:text-7xl">
          {t.hero.titleLead}
          <br />
          <span className="bg-gradient-to-r from-[var(--color-jb-orange)] via-[var(--color-accent2)] to-[var(--color-jb-purple)] bg-clip-text text-transparent">
            {t.hero.titleHighlight}
          </span>{" "}
          {t.hero.titleTail}
          <FlipWords
            words={t.hero.words}
            className="text-[var(--color-jb-purple)]"
          />
        </h1>

        <p className="mt-8 max-w-3xl text-pretty text-base leading-relaxed text-neutral-400 md:text-lg">
          {t.hero.sub}
        </p>

        <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
          <MovingBorderButton
            as="a"
            href={LINKS.releases}
            target="_blank"
            rel="noreferrer"
            borderRadius="9999px"
            duration={4500}
            containerClassName="h-12 w-56 text-sm"
            borderClassName="bg-[radial-gradient(var(--color-jb-purple)_40%,transparent_60%)] opacity-80"
            className="border-white/10 bg-black font-semibold text-white"
          >
            {t.hero.ctaDownload}
          </MovingBorderButton>
          <SiteLink
            href={STORE_URL}
            className="flex items-center gap-2 rounded-full bg-white px-7 py-3 text-sm font-semibold text-black transition-colors hover:bg-neutral-200"
          >
            {t.hero.ctaStore}
            <span aria-hidden="true">→</span>
          </SiteLink>
          <SiteLink
            href={docsPath(locale)}
            className="rounded-full border border-white/15 px-7 py-3 text-sm font-semibold text-neutral-200 transition-colors hover:border-white/40 hover:text-white"
          >
            {t.hero.ctaDocs}
          </SiteLink>
        </div>

        <p className="mt-8 font-mono text-xs uppercase tracking-widest text-neutral-600">
          {t.hero.platforms}
        </p>
      </div>

      <SiteLink
        href="#features"
        className="absolute bottom-6 z-10 flex flex-col items-center gap-1 font-mono text-[11px] uppercase tracking-widest text-neutral-600 transition-colors hover:text-neutral-300"
      >
        {t.hero.scroll}
        <ArrowDownIcon className="h-4 w-4 animate-bounce" />
      </SiteLink>
    </section>
  );
}
