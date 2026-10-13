import { motion } from "motion/react";

import { PinContainer } from "@/components/aceternity/3d-pin";
import { useLocale } from "@/intro/i18n";
import { HexLogo, SectionHead } from "./brand";

export function Security() {
  const { t } = useLocale();
  const [host, port] = t.security.keyValue.split(":");
  return (
    <section id="security" className="mx-auto max-w-7xl px-6 py-28">
      <SectionHead
        eyebrow={t.security.eyebrow}
        title={t.security.heading}
        sub={t.security.sub}
      />
      <div className="mt-14 grid items-center gap-12 lg:grid-cols-[1.2fr_1fr]">
        <div className="grid gap-4 sm:grid-cols-2">
          {t.security.bullets.map((b, i) => (
            <motion.div
              key={b.title}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ delay: i * 0.06, duration: 0.5 }}
              className={`rounded-2xl border border-white/10 bg-white/[0.03] p-5 ${
                i === t.security.bullets.length - 1 ? "sm:col-span-2" : ""
              }`}
            >
              <h3 className="text-[15px] font-semibold text-white">{b.title}</h3>
              <p className="mt-2 text-sm leading-6 text-white/50">{b.description}</p>
            </motion.div>
          ))}
        </div>
        <div className="flex justify-center py-10">
          <PinContainer title={t.security.keyLabel} href="#security" containerClassName="h-72 w-72">
            <div className="flex h-full w-64 flex-col items-center justify-center gap-3">
              <HexLogo className="size-14" />
              <p className="font-mono text-lg font-semibold tracking-tight text-white">{host}</p>
              <p className="font-mono text-3xl font-bold tracking-tight text-jb-green">
                :{port ?? "24056"}
              </p>
              <p className="mt-2 max-w-[12rem] text-center text-xs leading-5 text-white/45">
                {t.security.keyNote}
              </p>
            </div>
          </PinContainer>
        </div>
      </div>
    </section>
  );
}
