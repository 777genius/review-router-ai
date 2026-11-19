"use client";

import {
  useId,
  useMemo,
  useState,
  type FocusEvent,
  type ReactNode,
} from "react";
import { gatewayModelSchema } from "@reviewrouter/features-review-providers";
import type { AccountModelOption } from "../../../src/features/provider-setup/provider-model-options";

/**
 * A typed name on an account catalog: reviews may use only a model the account's
 * own list includes, so a well-formed name outside it is explained, not accepted.
 */
function typedAccountModelHint(value: string): string {
  return gatewayModelSchema.safeParse(value).success
    ? "This account's model list does not include this model. Choose a listed model, or refresh the list if the provider added it recently."
    : "This is not a valid model name. Use letters, digits and . _ : / - without spaces.";
}

/** A model name with suggestions from the catalog; any typed name is kept. */
export function ProviderModelInput({
  value,
  options,
  allowCustomModel,
  disabled,
  onValueChange,
  status,
  className,
}: {
  readonly value: string;
  readonly options: readonly AccountModelOption[];
  readonly allowCustomModel: boolean;
  readonly disabled: boolean;
  readonly onValueChange: (value: string) => void;
  readonly status?: ReactNode;
  readonly className?: string;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [activeValue, setActiveValue] = useState<string | null>(null);
  const listboxId = useId();
  const inputId = useId();
  const selected = options.find((option) => option.value === value);
  const filtered = useMemo(() => {
    const query = value.trim().toLowerCase();
    if (!query || selected) return options;
    return options.filter((option) =>
      [option.label, option.value, option.description ?? ""].some((text) =>
        text.toLowerCase().includes(query),
      ),
    );
  }, [options, selected, value]);

  function closeWhenFocusLeaves(event: FocusEvent<HTMLDivElement>): void {
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.contains(next)) return;
    setOpen(false);
  }

  // A div, not a label: the status under the input may hold its own button.
  return (
    <div
      className={[
        "relative grid min-w-0 gap-2 text-sm text-slate-300",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      onBlur={closeWhenFocusLeaves}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <label
        htmlFor={inputId}
        className="font-mono text-xs font-semibold uppercase tracking-[0.14em] text-slate-400"
      >
        Model
      </label>
      <span className="relative block">
        <input
          id={inputId}
          value={value}
          role="combobox"
          disabled={disabled}
          onChange={(event) => {
            onValueChange(event.target.value);
            setActiveValue(null);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setOpen(true);
              const available = filtered.filter((option) => !option.disabled);
              const current = available.findIndex(
                (option) => option.value === activeValue,
              );
              const next =
                event.key === "ArrowDown"
                  ? (current + 1) % available.length
                  : current <= 0
                    ? available.length - 1
                    : current - 1;
              setActiveValue(available[next]?.value ?? null);
            } else if (event.key === "Enter" && open) {
              event.preventDefault();
              const active = filtered.find(
                (option) => option.value === activeValue && !option.disabled,
              );
              if (!active) return;
              onValueChange(active.value);
              setActiveValue(null);
              setOpen(false);
            }
          }}
          aria-controls={listboxId}
          aria-expanded={open}
          aria-activedescendant={
            open && activeValue
              ? `${listboxId}-${filtered.findIndex((option) => option.value === activeValue)}`
              : undefined
          }
          aria-autocomplete="list"
          aria-label="Model"
          autoComplete="off"
          spellCheck={false}
          className="min-h-11 w-full rounded-xl border border-cyan-200/15 bg-slate-950/80 px-3 py-2 pr-12 text-cyan-50 outline-none transition placeholder:text-slate-500 hover:border-cyan-200/30 focus:border-cyan-300/55 focus:ring-2 focus:ring-cyan-300/20 disabled:cursor-not-allowed disabled:opacity-50"
        />
        <button
          type="button"
          disabled={disabled}
          aria-label="Show models"
          onClick={() => setOpen((current) => !current)}
          className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg text-cyan-100/80 transition hover:bg-cyan-300/[0.08] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span aria-hidden="true">⌄</span>
        </button>
      </span>
      {value &&
      (!selected || (selected.disabled && !selected.awaitsAccountList)) ? (
        <span className="text-xs text-slate-400">
          {selected?.disabled
            ? `${selected.description ?? "This model is unavailable for review."} Choose an available model from the catalog.`
            : allowCustomModel
              ? "Not in the list; this name is used as typed."
              : typedAccountModelHint(value)}
        </span>
      ) : null}
      {status}
      {open ? (
        <div
          id={listboxId}
          role="listbox"
          className="absolute left-0 right-0 top-full z-[70] mt-2 max-h-72 overflow-y-auto rounded-xl border border-cyan-200/20 bg-[var(--rr-surface-menu)] p-1 shadow-[var(--rr-shadow-elevated)]"
        >
          {filtered.length === 0 ? (
            <div className="px-3 py-3 text-sm text-slate-400">
              {allowCustomModel
                ? "No listed model matches. The typed name is used."
                : "No listed model matches. Try another name or model id."}
            </div>
          ) : null}
          {filtered.map((option, index) => (
            <button
              key={option.value}
              type="button"
              role="option"
              id={`${listboxId}-${index}`}
              aria-label={option.label}
              aria-disabled={option.disabled || undefined}
              aria-selected={option.value === value}
              disabled={option.disabled}
              onMouseDown={(event) => event.preventDefault()}
              onMouseMove={() =>
                setActiveValue(option.disabled ? null : option.value)
              }
              onClick={() => {
                if (option.disabled) return;
                onValueChange(option.value);
                setActiveValue(null);
                setOpen(false);
              }}
              className={[
                "grid w-full gap-0.5 rounded-lg px-3 py-2 text-left transition hover:bg-cyan-300/[0.08] disabled:cursor-not-allowed disabled:opacity-55",
                option.value === value || option.value === activeValue
                  ? "bg-cyan-300/[0.1] text-cyan-50"
                  : "text-slate-300",
              ].join(" ")}
            >
              <span className="flex min-w-0 items-center justify-between gap-3 text-sm font-semibold">
                <span className="min-w-0 truncate">{option.label}</span>
                {option.badge ? (
                  <span className="rounded-md border border-cyan-300/30 px-1.5 py-0.5 text-[0.62rem] font-bold uppercase leading-none text-cyan-100">
                    {option.badge}
                  </span>
                ) : null}
              </span>
              <span className="text-xs text-slate-500">{option.value}</span>
              {option.description ? (
                <span className="text-xs leading-5 text-slate-400">
                  {option.description}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
