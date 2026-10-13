import { Ripple } from "@/components/aceternity/ripple";
import { ShimmerButton } from "@/components/aceternity/shimmer-button";
import SiteLink from "@/intro/components/SiteLink";
import { useLocale } from "@/intro/i18n";
import { LINKS, STORE_URL } from "@/intro/site/config";
import { DownloadIcon } from "./brand";

export function CallToAction() {
  const { t } = useLocale();
  return (
    <section className="relative overflow-hidden border-t border-white/10 py-36">
      <Ripple mainCircleSize={240} mainCircleOpacity={0.22} numCircles={7} />
      <div className="relative mx-auto max-w-3xl px-6 text-center">
        <h2 className="font-display text-4xl font-bold tracking-tight text-white sm:text-5xl">
          {t.cta.heading}
        </h2>
        <p className="mt-5 text-white/55">{t.cta.sub}</p>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
          <ShimmerButton
            onClick={() => window.open(LINKS.releases, "_blank", "noreferrer")}
            shimmerColor="rgba(246,189,96,0.9)"
            className="text-base"
          >
            <DownloadIcon className="size-4" />
            {t.cta.primary}
          </ShimmerButton>
          <SiteLink
            href={LINKS.github}
            target="_blank"
            rel="noreferrer"
            className="flex h-12 items-center rounded-full border border-white/20 px-8 text-sm font-semibold text-white/85 transition-colors hover:border-white/50 hover:text-white"
          >
            {t.cta.secondary}
          </SiteLink>
          <SiteLink
            href={STORE_URL}
            className="flex h-12 items-center rounded-full border border-white/20 px-8 text-sm font-semibold text-white/85 transition-colors hover:border-white/50 hover:text-white"
          >
            {t.nav.store} →
          </SiteLink>
        </div>
      </div>
    </section>
  );
}
