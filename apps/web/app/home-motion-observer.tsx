"use client";

import { useEffect } from "react";

/**
 * Marks every `.rr-home-motion` element as visible the first time it scrolls
 * into view so the landing's entrance animations only run on demand.
 */
export function HomeMotionObserver(): null {
  useEffect(() => {
    if (!("IntersectionObserver" in window)) return;
    if (
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;

    const elements = document.querySelectorAll<HTMLElement>(".rr-home-motion");
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            (entry.target as HTMLElement).dataset.motionVisible = "true";
            observer.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.08, rootMargin: "0px 0px -12% 0px" },
    );
    for (const element of elements) observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return null;
}
