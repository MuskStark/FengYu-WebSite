"use client";
/**
 * Aceternity UI — Border Beam (ui.aceternity.com/components/border-beam).
 * A light beam travels the border of the parent (position: relative) card via
 * CSS offset-path; the border itself is masked so only the beam shows color.
 */
import { cn } from "@/lib/utils";
import { motion } from "motion/react";
import React from "react";

interface BorderBeamProps {
  className?: string;
  size?: number;
  duration?: number;
  borderWidth?: number;
  colorFrom?: string;
  colorTo?: string;
  delay?: number;
  /** Corner radius of the travel path — should match the parent card's radius. */
  borderRadius?: number;
}

export const BorderBeam = ({
  className,
  size = 60,
  duration = 6,
  borderWidth = 1.5,
  colorFrom = "#a73afd",
  colorTo = "#fc801d",
  delay = 0,
  borderRadius,
}: BorderBeamProps) => {
  const radius = borderRadius ?? Math.min(size, 24);
  return (
    <>
      <div
        className="pointer-events-none absolute inset-0 rounded-[inherit] border-transparent [mask-clip:padding-box,border-box] [mask-composite:intersect] [mask-image:linear-gradient(transparent,transparent),linear-gradient(#000,#000)]"
        style={{ borderWidth, borderStyle: "solid" }}
      />
      <motion.div
        className={cn(
          "pointer-events-none absolute aspect-square rounded-full",
          className,
        )}
        style={{
          width: size,
          offsetPath: `rect(0 auto auto 0 round ${radius}px)`,
          background: `linear-gradient(to left, transparent, ${colorFrom}, ${colorTo})`,
        }}
        initial={{ offsetDistance: "0%" }}
        animate={{ offsetDistance: "100%" }}
        transition={{
          repeat: Infinity,
          ease: "linear",
          duration,
          delay: -delay,
        }}
      />
    </>
  );
};
