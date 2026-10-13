"use client";
/**
 * Aceternity UI — Ripple (ui.aceternity.com/components/ripple).
 * Concentric rings expanding outward from behind the CTA; the ring loop is
 * driven by the `animate-ripple` keyframes declared in index.css.
 */
import { cn } from "@/lib/utils";
import React from "react";

interface RippleProps {
  mainCircleSize?: number;
  mainCircleOpacity?: number;
  mainCircleClassName?: string;
  numCircles?: number;
}

export const Ripple = React.memo(function Ripple({
  mainCircleSize = 210,
  mainCircleOpacity = 0.24,
  numCircles = 8,
  mainCircleClassName,
}: RippleProps) {
  return (
    <div
      className="pointer-events-none absolute inset-0 select-none overflow-hidden [mask-image:linear-gradient(to_bottom,black,transparent)]"
      aria-hidden="true"
    >
      {Array.from({ length: numCircles }, (_, i) => (
        <div
          key={i}
          className={cn("animate-ripple absolute rounded-full border", mainCircleClassName)}
          style={{
            width: mainCircleSize,
            height: mainCircleSize,
            left: "50%",
            top: "50%",
            marginLeft: -mainCircleSize / 2,
            marginTop: -mainCircleSize / 2,
            borderColor: `rgba(167,58,253,${mainCircleOpacity})`,
            animationDelay: `${-0.4 * i}s`,
          }}
        />
      ))}
    </div>
  );
});
