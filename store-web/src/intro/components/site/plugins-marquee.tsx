import { InfiniteMovingCards } from "@/components/aceternity/infinite-moving-cards";
import { useLocale } from "@/intro/i18n";
import { SectionHead } from "./brand";

export function PluginsMarquee() {
  const { t } = useLocale();
  const cards = t.plugins.cards.map((c) => ({
    quote: c.quote,
    name: c.name,
    title: c.title,
  }));
  return (
    <section id="plugins" className="py-28">
      <div className="mx-auto max-w-7xl px-6">
        <SectionHead eyebrow={t.plugins.eyebrow} title={t.plugins.heading} sub={t.plugins.sub} />
      </div>
      <div className="mt-12">
        <InfiniteMovingCards
          items={[...cards, ...cards]}
          className="w-full max-w-none"
          direction="left"
          speed="slow"
          pauseOnHover
        />
      </div>
    </section>
  );
}
