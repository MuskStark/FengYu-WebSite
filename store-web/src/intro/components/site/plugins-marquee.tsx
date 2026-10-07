import SiteLink from "@/intro/components/SiteLink";

import { InfiniteMovingCards } from "@/intro/components/ui/infinite-moving-cards";
import { SectionHeading } from "@/intro/components/site/section-heading";
import { useLocale } from "@/intro/i18n";
import { docsPath } from "@/intro/site/config";

export function PluginsMarquee() {
  const { t, locale } = useLocale();

  return (
    <section id="plugins" className="relative w-full overflow-hidden py-24">
      <div className="mx-auto max-w-7xl px-6">
        <SectionHeading
          eyebrow={t.plugins.eyebrow}
          title={t.plugins.heading}
          sub={t.plugins.sub}
          className="mb-12"
        />
      </div>
      <div className="flex flex-col items-center gap-6 [mask-image:linear-gradient(to_right,transparent,black_15%,black_85%,transparent)]">
        {/* key={locale}: the component clones its items once on mount, so it
            must remount when the dictionary changes or the clones keep the
            previous language's text. */}
        <InfiniteMovingCards
          key={`left-${locale}`}
          items={t.plugins.cards as unknown as { quote: string; name: string; title: string }[]}
          direction="left"
          speed="slow"
          pauseOnHover
        />
        <InfiniteMovingCards
          key={`right-${locale}`}
          items={[
            t.plugins.cards[4],
            t.plugins.cards[0],
            t.plugins.cards[2],
            t.plugins.cards[1],
            t.plugins.cards[3],
          ].map((c) => c as unknown as { quote: string; name: string; title: string })}
          direction="right"
          speed="slow"
          pauseOnHover
        />
        <SiteLink
          href={docsPath(locale, "plugins/marketplace")}
          className="mt-2 font-mono text-xs uppercase tracking-widest text-[var(--color-jb-green)] transition-colors hover:text-white"
        >
          {t.plugins.cta}
        </SiteLink>
      </div>
    </section>
  );
}
