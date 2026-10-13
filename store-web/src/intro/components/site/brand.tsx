import { useId } from "react";
import { motion } from "motion/react";

/** Brand hex mark — Infinia / FengYu bee-hive logogram in the brand gradient. */
export function HexLogo({ className }: { className?: string }) {
  const id = useId();
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden="true" className={className}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="32" y2="32">
          <stop offset="0%" stopColor="#fc801d" />
          <stop offset="55%" stopColor="#a73afd" />
          <stop offset="100%" stopColor="#0b70f5" />
        </linearGradient>
      </defs>
      <path
        d="M16 2.5 27.5 9v14L16 29.5 4.5 23V9L16 2.5Z"
        stroke={`url(#${id})`}
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <circle cx="16" cy="16" r="4.5" fill={`url(#${id})`} />
    </svg>
  );
}

export function DownloadIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M12 4v11m0 0 4.5-4.5M12 15l-4.5-4.5M5 19h14"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Shared section header: mono eyebrow, display title, muted subtitle. */
export function SectionHead({
  eyebrow,
  title,
  sub,
}: {
  eyebrow: string;
  title: string;
  sub?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.6 }}
      className="mx-auto max-w-2xl text-center"
    >
      <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-jb-purple">
        {"//"} {eyebrow}
      </p>
      <h2 className="mt-4 font-display text-3xl font-bold tracking-tight text-white sm:text-4xl">
        {title}
      </h2>
      {sub && <p className="mt-4 text-pretty leading-7 text-white/50">{sub}</p>}
    </motion.div>
  );
}
