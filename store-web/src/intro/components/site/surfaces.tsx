
import { HoverEffect } from "@/intro/components/ui/card-hover-effect";
import { SectionHeading } from "@/intro/components/site/section-heading";
import { useLocale } from "@/intro/i18n";
import { docsPath } from "@/intro/site/config";

export function Surfaces() {
  const { t, locale } = useLocale();

  const surfaceLinks = [
    docsPath(locale, "plugins/overview"),
    docsPath(locale, "skills/index"),
    docsPath(locale, "guide/ai-agent"),
  ];

  return (
    <section id="surfaces" className="relative w-full py-24">
      <div className="mx-auto max-w-7xl px-6">
        <SectionHeading
          eyebrow={t.surfaces.eyebrow}
          title={t.surfaces.heading}
          sub={t.surfaces.sub}
          className="mb-8"
        />
        <HoverEffect
          items={t.surfaces.items.map((item, i) => ({
            title: item.title,
            description: item.description,
            link: surfaceLinks[i] ?? docsPath(locale),
          }))}
          className="max-w-6xl mx-auto md:grid-cols-3"
        />
      </div>
    </section>
  );
}
