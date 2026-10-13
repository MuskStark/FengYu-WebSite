"use client";
/**
 * Aceternity UI — Expandable Card (ui.aceternity.com/components/expandable-card).
 * Click a compact card and it expands into a centered overlay via a shared
 * layoutId transition; the icon flips between plus and minus.
 */
import { cn } from "@/lib/utils";
import React, { useState } from "react";
import { AnimatePresence, motion } from "motion/react";

export function ExpandableCard({
  title,
  subtitle,
  eyebrow,
  children,
  className,
}: {
  title: string;
  subtitle: string;
  eyebrow?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const id = `expandable-${title}`;

  return (
    <>
      <motion.div
        layoutId={id}
        onClick={() => setOpen(true)}
        whileHover={{ y: -3 }}
        transition={{ type: "spring", stiffness: 350, damping: 30 }}
        className={cn(
          "group cursor-pointer rounded-2xl border border-white/10 bg-white/[0.03] p-6 transition-colors hover:border-white/25",
          className,
        )}
      >
        {eyebrow && (
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-white/40">
            {eyebrow}
          </p>
        )}
        <div className="mt-2 flex items-start justify-between gap-4">
          <h3 className="text-lg font-semibold text-white">{title}</h3>
          <motion.span
            aria-hidden="true"
            className="grid size-7 shrink-0 place-items-center rounded-full border border-white/15 text-white/60 transition-colors group-hover:border-white/40 group-hover:text-white"
            animate={{ rotate: open ? 45 : 0 }}
          >
            +
          </motion.span>
        </div>
        <p className="mt-2 text-sm leading-6 text-white/55">{subtitle}</p>
      </motion.div>

      <AnimatePresence>
        {open && (
          <motion.div
            className="fixed inset-0 z-[60] flex items-center justify-center p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
              onClick={() => setOpen(false)}
            />
            <motion.div
              layoutId={id}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
              className="relative z-10 max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-3xl border border-white/10 bg-neutral-950 p-8"
            >
              {eyebrow && (
                <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-jb-purple)]">
                  {eyebrow}
                </p>
              )}
              <h3 className="mt-2 text-2xl font-bold text-white">{title}</h3>
              <div className="mt-4 text-sm leading-7 text-white/70">
                {children}
              </div>
              <button
                onClick={() => setOpen(false)}
                className="mt-8 rounded-full border border-white/15 px-5 py-2 text-xs font-semibold text-white/70 transition-colors hover:border-white/40 hover:text-white"
              >
                收起
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
