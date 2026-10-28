"use client";

import { forwardRef, type ReactNode } from "react";
import { cn } from "../utils/cn";

export type TextFieldProps = Omit<
  React.ComponentPropsWithoutRef<"input">,
  "className"
> & {
  readonly label: ReactNode;
  /** Helper text under the control. */
  readonly hint?: ReactNode;
  readonly className?: string;
};

/**
 * A labelled single-line input with the same chrome as the select field, for
 * names, keys and other typed values.
 */
export const TextField = forwardRef<React.ElementRef<"input">, TextFieldProps>(
  function TextField({ label, hint, className, ...props }, ref) {
    return (
      <label
        className={cn("grid min-w-0 gap-2 text-sm text-slate-300", className)}
      >
        <span className="font-mono text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
          {label}
        </span>
        <input
          ref={ref}
          {...props}
          className="min-h-11 w-full min-w-0 rounded-xl border border-cyan-200/15 bg-slate-950/80 px-3 py-2 text-cyan-50 outline-none transition placeholder:text-slate-500 hover:border-cyan-200/30 focus:border-cyan-300/55 focus:ring-2 focus:ring-cyan-300/20 disabled:cursor-not-allowed disabled:opacity-50"
        />
        {hint ? (
          <span className="text-xs leading-5 text-slate-400">{hint}</span>
        ) : null}
      </label>
    );
  },
);
