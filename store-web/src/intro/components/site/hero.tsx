import { motion } from "motion/react";

import { Vortex } from "@/components/aceternity/vortex";
import { TextGenerateEffect } from "@/components/aceternity/text-generate-effect";
import { ShimmerButton } from "@/components/aceternity/shimmer-button";
import SiteLink from "@/intro/components/SiteLink";
import { useLocale } from "@/intro/i18n";
import { LINKS, STORE_URL } from "@/intro/site/config";
import { DownloadIcon } from "./brand";

export function Hero() {
  const { t } = useLocale();

  return (
    <section
      id="top"
      className="relative flex min-h-screen w-full flex-col items-center justify-center overflow-hidden pt-16"
    >
      <Vortex
        containerClassName="min-h-screen w-full h-full"
        backgroundColor="black"
        baseHue={252}
        rangeHue={55}
        particleCount={600}
        baseSpeed={0.05}
        rangeSpeed={0.6}
        className="flex min-h-screen items-center justify-center px-6 pb-24 pt-40"
      >
        <div className="mx-auto flex w-full max-w-4xl flex-col items-center text-center">
          <span className="mb-8 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-1.5 font-mono text-xs text-white/70 backdrop-blur">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-jb-green opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-jb-green" />
            </span>
            {t.hero.badge}
          </span>

          <h1 className="font-display text-5xl font-bold leading-[1.08] tracking-tight sm:text-6xl md:text-7xl">
            <TextGenerateEffect
              words={t.hero.titleLead}
              duration={0.45}
              filter
              className="text-white"
            />
            <TextGenerateEffect
              words={`${t.hero.titleHighlight} ${t.hero.titleTail}`}
              duration={0.45}
              filter={false}
              className="bg-gradient-to-r from-jb-orange via-jb-purple to-jb-blue bg-clip-text text-transparent"
            />
          </h1>

          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 1.4, duration: 0.6 }}
            className="mt-8 max-w-2xl text-pretty text-base leading-relaxed text-white/55 md:text-lg"
          >
            {t.hero.sub}
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 1.7, duration: 0.6 }}
            className="mt-10 flex flex-wrap items-center justify-center gap-4"
          >
            <ShimmerButton
              onClick={() => window.open(LINKS.releases, "_blank", "noreferrer")}
              shimmerColor="rgba(246,189,96,0.9)"
            >
              <DownloadIcon className="size-4" />
              {t.hero.ctaDownload}
            </ShimmerButton>
            <SiteLink
              href={STORE_URL}
              className="flex h-12 items-center rounded-full border border-white/20 px-8 text-sm font-semibold text-white/85 transition-colors hover:border-white/50 hover:text-white"
            >
              {t.hero.ctaStore} →
            </SiteLink>
          </motion.div>

          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 2 }}
            className="mt-8 font-mono text-[11px] uppercase tracking-[0.3em] text-white/30"
          >
            {t.hero.platforms}
          </motion.p>
        </div>
      </Vortex>
    </section>
  );
}
