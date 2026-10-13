import { CardSpotlight } from "@/components/aceternity/card-spotlight";
import { useLocale } from "@/intro/i18n";
import { SectionHead } from "./brand";

/** Language-neutral CLI / code lines shown under each surface card. */
const CLI_LINES = [
  "fengyu init --runtime java|python|go",
  "fengyu check && fengyu build",
  "publish → dynamic tool discovery",
];

const COLORS = ["#21d789", "#fc801d", "#a73afd"];

export function Surfaces() {
  const { t } = useLocale();
  return (
    <section id="surfaces" className="mx-auto max-w-7xl px-6 py-28">
      <SectionHead eyebrow={t.surfaces.eyebrow} title={t.surfaces.heading} sub={t.surfaces.sub} />
      <div className="mt-14 grid gap-6 md:grid-cols-3">
        {t.surfaces.items.map((s, i) => (
          <CardSpotlight key={s.title} color={COLORS[i % COLORS.length]} radius={320} className="min-h-[22rem]">
            <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-white/40">
              EXTENSION {String(i + 1).padStart(2, "0")}
            </p>
            <h3 className="mt-4 font-display text-2xl font-semibold text-white">{s.title}</h3>
            <p className="mt-3 text-sm leading-6 text-white/55">{s.description}</p>
            <p className="mt-6 rounded-lg border border-white/10 bg-black/50 px-3 py-2 font-mono text-xs text-white/60">
              $ {CLI_LINES[i % CLI_LINES.length]}
            </p>
          </CardSpotlight>
        ))}
      </div>
    </section>
  );
}
