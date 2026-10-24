"use client";

import { useId, type ReactNode } from "react";
import { Select as BaseSelect } from "@base-ui/react/select";
import { cn } from "../utils/cn";

export type SelectFieldOption = {
  readonly value: string;
  readonly label: string;
  readonly description?: string;
  readonly disabled?: boolean;
  /** A small logo before the label, also shown on the control when selected. */
  readonly icon?: ReactNode;
};

export type SelectFieldProps = {
  /** Form field name; omit for a controlled select outside a form. */
  readonly name?: string;
  readonly label: ReactNode;
  readonly options: readonly SelectFieldOption[];
  readonly disabled?: boolean;
  readonly onValueChange?: (value: string) => void;
  /** Shown while no option is selected. */
  readonly placeholder?: string;
  /** Helper text under the control. */
  readonly hint?: ReactNode;
  readonly className?: string;
} & (
  | { readonly value: string; readonly defaultValue?: never }
  | { readonly value?: never; readonly defaultValue: string }
);

export function SelectField({
  name,
  label,
  defaultValue,
  value,
  options,
  disabled,
  onValueChange,
  placeholder,
  hint,
  className,
}: SelectFieldProps): React.ReactElement {
  const hintId = useId();
  // Only a controlled select knows its value here.
  const selectedIcon =
    value === undefined
      ? null
      : options.find((option) => option.value === value)?.icon;
  return (
    <label
      className={cn("grid min-w-0 gap-2 text-sm text-slate-300", className)}
    >
      <span className="font-mono text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
        {label}
      </span>
      <BaseSelect.Root
        name={name}
        {...(value === undefined ? { defaultValue } : { value })}
        disabled={disabled}
        onValueChange={(value) => {
          if (value !== null) onValueChange?.(value);
        }}
        items={options.map((option) => ({
          value: option.value,
          label: option.label,
        }))}
      >
        <BaseSelect.Trigger
          {...(hint ? { "aria-describedby": hintId } : {})}
          className={cn(
            "flex min-h-11 w-full min-w-0 items-center justify-between gap-3 rounded-xl border border-cyan-200/15 bg-slate-950/80 px-3 py-2 text-left text-cyan-50 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition hover:border-cyan-200/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300 disabled:cursor-not-allowed disabled:opacity-50",
          )}
        >
          <span className="flex min-w-0 items-center gap-2">
            {selectedIcon ?? null}
            <BaseSelect.Value
              className="min-w-0 truncate data-[placeholder]:text-slate-500"
              placeholder={placeholder}
            />
          </span>
          <BaseSelect.Icon className="shrink-0 text-cyan-100">
            ⌄
          </BaseSelect.Icon>
        </BaseSelect.Trigger>
        <BaseSelect.Portal>
          <BaseSelect.Positioner
            sideOffset={8}
            alignItemWithTrigger={false}
            className="z-[70]"
          >
            <BaseSelect.Popup
              className="max-h-72 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl border border-cyan-200/15 bg-[var(--rr-surface-menu)] p-1.5 text-cyan-50 shadow-[var(--rr-shadow-elevated),0_0_60px_-32px_rgba(0,240,255,0.9)] outline-none"
              style={{
                minWidth:
                  "min(max(var(--anchor-width), 18rem), calc(100vw - 2rem))",
              }}
            >
              <BaseSelect.List>
                {options.map((option) => (
                  <BaseSelect.Item
                    key={option.value}
                    value={option.value}
                    label={option.label}
                    disabled={option.disabled}
                    className="flex w-full cursor-pointer items-start gap-3 rounded-lg px-3.5 py-3 text-sm leading-5 text-slate-200 outline-none transition data-[highlighted]:bg-cyan-300/10 data-[highlighted]:text-cyan-50"
                  >
                    <BaseSelect.ItemIndicator className="flex h-5 w-5 shrink-0 items-center justify-center pt-0.5 text-lime-200">
                      ✓
                    </BaseSelect.ItemIndicator>
                    {option.icon ? (
                      <span className="shrink-0">{option.icon}</span>
                    ) : null}
                    <BaseSelect.ItemText className="min-w-0 flex-1">
                      <span className="block whitespace-normal font-medium">
                        {option.label}
                      </span>
                      {option.description ? (
                        <span className="mt-1 block whitespace-normal text-xs leading-5 text-slate-400">
                          {option.description}
                        </span>
                      ) : null}
                    </BaseSelect.ItemText>
                  </BaseSelect.Item>
                ))}
              </BaseSelect.List>
            </BaseSelect.Popup>
          </BaseSelect.Positioner>
        </BaseSelect.Portal>
      </BaseSelect.Root>
      {hint ? (
        <span id={hintId} className="text-xs leading-5 text-slate-400">
          {hint}
        </span>
      ) : null}
    </label>
  );
}
