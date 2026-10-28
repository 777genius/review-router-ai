"use client";

import { useId, type ReactNode } from "react";
import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import { cn } from "../utils/cn";

export type RadioCardGroupProps = {
  readonly value: string | null;
  readonly onValueChange: (value: string) => void;
  /** Accessible name of the group. */
  readonly label: string;
  readonly disabled?: boolean;
  readonly className?: string;
  readonly children: ReactNode;
};

/**
 * A single-choice list whose options are full-width rows: a radio, a title,
 * an optional description and trailing details. Disabled options stay
 * visible and say why.
 */
export function RadioCardGroup({
  value,
  onValueChange,
  label,
  disabled,
  className,
  children,
}: RadioCardGroupProps): React.ReactElement {
  return (
    <RadioGroup
      aria-label={label}
      value={value}
      disabled={disabled}
      onValueChange={(next) => {
        if (typeof next === "string") onValueChange(next);
      }}
      className={cn("grid gap-2", className)}
    >
      {children}
    </RadioGroup>
  );
}

export type RadioCardProps = {
  readonly value: string;
  readonly title: ReactNode;
  readonly description?: ReactNode;
  /** Leading visual, such as a provider logo. */
  readonly icon?: ReactNode;
  /** Trailing details, such as badges. */
  readonly meta?: ReactNode;
  readonly disabled?: boolean;
  /** Shown instead of the description when the option is disabled. */
  readonly disabledReason?: ReactNode;
  readonly className?: string;
  readonly children?: ReactNode;
};

export function RadioCard({
  value,
  title,
  description,
  icon,
  meta,
  disabled = false,
  disabledReason,
  className,
  children,
}: RadioCardProps): React.ReactElement {
  // The radio is named by its title and described by its details (such as
  // "Default" or "In use") and its description, or the reason it is
  // disabled, instead of reading the whole row as a name.
  const titleId = useId();
  const metaId = useId();
  const descriptionId = useId();
  const explanation = disabled && disabledReason ? disabledReason : description;
  const describedBy = [meta ? metaId : null, explanation ? descriptionId : null]
    .filter(Boolean)
    .join(" ");
  return (
    <label
      data-disabled={disabled ? "" : undefined}
      className={cn(
        "group/radio-card flex min-w-0 cursor-pointer items-start gap-3 rounded-xl border border-cyan-200/12 bg-slate-950/40 px-3.5 py-3 text-left transition",
        "hover:border-cyan-200/30 hover:bg-cyan-300/[0.04]",
        "has-[[data-checked]]:border-cyan-300/55 has-[[data-checked]]:bg-cyan-300/[0.07]",
        "has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-cyan-300/70",
        "data-[disabled]:cursor-not-allowed data-[disabled]:border-slate-700/50 data-[disabled]:bg-transparent data-[disabled]:hover:bg-transparent",
        className,
      )}
    >
      <Radio.Root
        value={value}
        disabled={disabled}
        aria-labelledby={titleId}
        {...(describedBy ? { "aria-describedby": describedBy } : {})}
        className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border border-cyan-200/40 bg-slate-950 outline-none transition data-[checked]:border-cyan-300 data-[disabled]:border-slate-600"
      >
        <Radio.Indicator className="h-2 w-2 rounded-full bg-cyan-300" />
      </Radio.Root>
      {icon ? <span className="shrink-0">{icon}</span> : null}
      <span className="grid min-w-0 flex-1 gap-1">
        <span className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <span
            id={titleId}
            className={cn(
              "min-w-0 break-words text-sm font-semibold leading-5",
              disabled ? "text-slate-500" : "text-cyan-50",
            )}
          >
            {title}
          </span>
          {meta ? (
            <span id={metaId} className="flex flex-wrap items-center gap-1.5">
              {meta}
            </span>
          ) : null}
        </span>
        {explanation ? (
          <span
            id={descriptionId}
            className={cn(
              "text-xs leading-5",
              disabled && disabledReason
                ? "text-amber-100/80"
                : "text-slate-400",
            )}
          >
            {explanation}
          </span>
        ) : null}
        {children}
      </span>
    </label>
  );
}
