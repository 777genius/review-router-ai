"use client";

import { forwardRef } from "react";
import { cn } from "../utils/cn";

export type CheckboxProps = React.ComponentPropsWithoutRef<"input">;

const checkMark =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='%230a0a0f' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M3.5 8.5l3 3 6-6'/%3E%3C/svg%3E";

export const Checkbox = forwardRef<React.ElementRef<"input">, CheckboxProps>(
  function Checkbox({ className, style, ...props }, ref) {
    return (
      <input
        ref={ref}
        type="checkbox"
        className={cn(
          "size-5 shrink-0 cursor-pointer appearance-none rounded-md border border-cyan-200/30 bg-slate-950/80 transition-colors",
          "checked:border-cyan-300 checked:bg-cyan-300 checked:bg-[image:var(--rr-check)] checked:bg-center checked:bg-[length:0.9rem] checked:bg-no-repeat",
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300/70",
          "disabled:cursor-not-allowed disabled:border-slate-500/60 disabled:bg-slate-700/60",
          "disabled:checked:border-slate-500/60 disabled:checked:bg-slate-600/60",
          className,
        )}
        style={{ ["--rr-check" as string]: `url("${checkMark}")`, ...style }}
        {...props}
      />
    );
  },
);
