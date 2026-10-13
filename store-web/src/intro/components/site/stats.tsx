import { useLocale } from "@/intro/i18n";

export function StatsStrip() {
  const { t } = useLocale();
  return (
    <section className="border-y border-white/10">
      <div className="mx-auto grid max-w-7xl grid-cols-2 divide-white/10 md:grid-cols-4 md:divide-x">
        {t.stats.map((s) => (
          <div key={s.label} className="px-6 py-10 text-center">
            <div className="bg-gradient-to-b from-white to-white/50 bg-clip-text font-display text-4xl font-bold text-transparent">
              {s.value}
            </div>
            <div className="mt-2 font-mono text-[11px] uppercase tracking-[0.2em] text-white/40">
              {s.label}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
