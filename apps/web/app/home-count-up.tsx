"use client";

import { useEffect, useState } from "react";

export type HomeMotionPhase = "static" | "armed" | "playing";

type HomeCountUpProps = {
  value: number;
  decimals?: number;
  suffix?: string;
  phase: HomeMotionPhase;
  durationMs?: number;
  delayMs?: number;
};

const easeOutQuart = (t: number): number => 1 - Math.pow(1 - t, 4);

/**
 * Counts from 0 to `value` while `phase` is "playing", with a short lift and
 * blur like the product video. "static" (server markup, reduced motion) shows
 * the final number; "armed" shows zero until the animation starts.
 */
export function HomeCountUp({
  value,
  decimals = 0,
  suffix = "",
  phase,
  durationMs = 1000,
  delayMs = 0,
}: HomeCountUpProps): React.ReactElement {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (phase !== "playing") return;
    let frame = 0;
    const timer = window.setTimeout(() => {
      const startedAt = performance.now();
      const tick = (now: number): void => {
        const t = Math.min((now - startedAt) / durationMs, 1);
        setProgress(easeOutQuart(t));
        if (t < 1) frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    }, delayMs);
    return () => {
      window.clearTimeout(timer);
      cancelAnimationFrame(frame);
    };
  }, [phase, durationMs, delayMs]);

  const eased = phase === "static" ? 1 : phase === "armed" ? 0 : progress;
  const text = `${(value * eased).toFixed(decimals)}${suffix}`;
  const final = `${value.toFixed(decimals)}${suffix}`;

  return (
    <span className="rr-home-count">
      <span className="sr-only">{final}</span>
      <span
        aria-hidden="true"
        style={
          phase === "static"
            ? undefined
            : {
                display: "inline-block",
                transform: `translateY(${((1 - eased) * 14).toFixed(1)}px)`,
                filter: `blur(${((1 - eased) * 1.8).toFixed(1)}px)`,
              }
        }
      >
        {text}
      </span>
    </span>
  );
}
