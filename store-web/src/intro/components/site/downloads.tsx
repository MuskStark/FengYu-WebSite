import { HoverBorderGradient } from "@/components/aceternity/hover-border-gradient";
import SiteLink from "@/intro/components/SiteLink";
import { useLocale } from "@/intro/i18n";
import { LINKS } from "@/intro/site/config";
import { DownloadIcon, SectionHead } from "./brand";

export function Downloads() {
  const { t } = useLocale();
  return (
    <section id="downloads" className="mx-auto max-w-7xl px-6 py-28">
      <SectionHead
        eyebrow={t.downloads.eyebrow}
        title={t.downloads.heading}
        sub={t.downloads.sub}
      />
      <div className="mt-14 flex flex-wrap justify-center gap-6">
        {t.downloads.cards.map((d, i) => (
          <HoverBorderGradient
            key={d.os}
            as="div"
            containerClassName="rounded-2xl"
            className="flex h-full w-72 flex-col items-start gap-3 bg-black p-6 text-left"
            duration={1.2 + i * 0.2}
            clockwise={i % 2 === 0}
          >
            <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-white/40">
              {d.os}
            </span>
            <p className="min-h-16 text-sm leading-6 text-white/60">{d.detail}</p>
            <SiteLink
              href={LINKS.releases}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex items-center gap-2 text-sm font-semibold text-white"
            >
              {d.cta}
              <DownloadIcon className="size-4" />
            </SiteLink>
          </HoverBorderGradient>
        ))}
      </div>
      <p className="mt-10 text-center text-sm text-white/40">
        {t.downloads.webTitle}{" "}
        <span className="font-mono text-white/60">./run.sh</span> ·{" "}
        <SiteLink
          href={LINKS.releases}
          target="_blank"
          rel="noreferrer"
          className="text-white/60 underline decoration-white/30 underline-offset-4 transition-colors hover:text-white"
        >
          {t.downloads.allReleases}
        </SiteLink>
      </p>
    </section>
  );
}
