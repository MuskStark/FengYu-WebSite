import { ExpandableCard } from "@/components/aceternity/expandable-card";
import { useLocale } from "@/intro/i18n";
import { SectionHead } from "./brand";

export function Faq() {
  const { t } = useLocale();
  return (
    <section id="faq" className="mx-auto max-w-5xl px-6 py-28">
      <SectionHead eyebrow={t.faq.eyebrow} title={t.faq.heading} sub={t.faq.sub} />
      <div className="mt-14 grid gap-4 md:grid-cols-2">
        {t.faq.items.map((f) => (
          <ExpandableCard
            key={f.q}
            title={f.q}
            subtitle={`${f.a.slice(0, 60)}…`}
            eyebrow="FAQ"
          >
            {f.a}
          </ExpandableCard>
        ))}
      </div>
    </section>
  );
}
