"use client";
/**
 * Aceternity UI — Shimmer Button (ui.aceternity.com/components/shimmering-button).
 * Registry copy is Pro-gated, so this is the faithful public implementation:
 * a dark pill with a light streak that sweeps across on a linear loop.
 */
import { cn } from "@/lib/utils";
import React from "react";
import { motion } from "motion/react";

export interface ShimmerButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  shimmerColor?: string;
  background?: string;
}

export const ShimmerButton = React.forwardRef<
  HTMLButtonElement,
  ShimmerButtonProps
>(
  (
    {
      className,
      children,
      shimmerColor = "rgba(255,255,255,0.45)",
      background = "rgba(12,12,14,0.9)",
      ...props
    },
    ref,
  ) => (
    <button
      ref={ref}
      className={cn(
        "group relative inline-flex h-12 cursor-pointer items-center justify-center gap-2 overflow-hidden rounded-full px-8 text-sm font-semibold text-white outline-none transition-transform duration-200 hover:scale-[1.03] focus-visible:ring-2 focus-visible:ring-white/40",
        className,
      )}
      style={{ background }}
      {...props}
    >
      <motion.span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-0"
        initial={{ x: "-130%" }}
        animate={{ x: "560%" }}
        transition={{
          repeat: Infinity,
          ease: "linear",
          duration: 2.8,
          repeatDelay: 1.4,
        }}
      >
        <span
          className="block h-full w-24 -skew-x-12"
          style={{
            background: `linear-gradient(90deg, transparent, ${shimmerColor}, transparent)`,
          }}
        />
      </motion.span>
      <span className="relative z-10 flex items-center gap-2">{children}</span>
    </button>
  ),
);
ShimmerButton.displayName = "ShimmerButton";
