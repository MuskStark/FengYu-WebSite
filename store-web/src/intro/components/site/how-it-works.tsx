import { Timeline } from "@/components/aceternity/timeline";
import { useLocale } from "@/intro/i18n";
import { SectionHead } from "./brand";

export function HowItWorks() {
  const { t } = useLocale();
  return (
    <section id="how" className="mx-auto max-w-7xl px-6 py-28">
      <SectionHead eyebrow={t.how.eyebrow} title={t.how.heading} sub={t.how.sub} />
      <div className="mt-8">
        <Timeline
          data={t.how.steps.map((s) => ({
            title: s.title,
            content: <p className="text-sm leading-7 text-white/55">{s.description}</p>,
          }))}
        />
      </div>
    </section>
  );
}
