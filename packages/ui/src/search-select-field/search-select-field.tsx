"use client";

import { useId, type ReactNode } from "react";
import { Combobox } from "@base-ui/react/combobox";
import { Button } from "../button/button";
import { cn } from "../utils/cn";

export type SearchSelectOption = {
  readonly value: string;
  readonly label: string;
};
export type SearchSelectFieldProps = {
  readonly label: string;
  readonly value: SearchSelectOption;
  readonly options: readonly SearchSelectOption[];
  readonly search: string;
  readonly onSearchChange: (search: string) => void;
  readonly onValueChange: (option: SearchSelectOption) => void;
  readonly onOpenChange?: (open: boolean) => void;
  readonly loading?: boolean;
  readonly disabled?: boolean;
  readonly message?: ReactNode;
  readonly hasMore?: boolean;
  readonly onLoadMore?: () => void;
  readonly className?: string;
};

/** A shared, remote-filtered select. Data and pagination remain with its feature. */
export function SearchSelectField({
  label,
  value,
  options,
  search,
  onSearchChange,
  onValueChange,
  onOpenChange,
  loading,
  disabled,
  message,
  hasMore,
  onLoadMore,
  className,
}: SearchSelectFieldProps) {
  const id = useId();
  const items = [
    value,
    ...options.filter((option) => option.value !== value.value),
  ];
  return (
    <div className={cn("grid min-w-0 gap-2 text-sm text-slate-300", className)}>
      <span
        id={`${id}-label`}
        className="font-mono text-xs font-semibold uppercase tracking-[0.14em] text-slate-400"
      >
        {label}
      </span>
      <Combobox.Root<SearchSelectOption>
        items={items}
        value={value}
        filter={null}
        inputValue={search}
        onInputValueChange={(text, details) => {
          if (
            details.reason !== "item-press" &&
            details.reason !== "input-clear"
          )
            onSearchChange(text);
        }}
        isItemEqualToValue={(option, selected) =>
          option.value === selected.value
        }
        itemToStringLabel={(option) => option.label}
        itemToStringValue={(option) => option.value}
        onValueChange={(option) => {
          if (option) onValueChange(option);
        }}
        onOpenChange={(open) => onOpenChange?.(open)}
        disabled={disabled}
      >
        <Combobox.Trigger
          aria-labelledby={`${id}-label ${id}-value`}
          className="flex min-h-11 w-full min-w-0 items-center justify-between gap-2 rounded-xl border border-cyan-200/15 bg-slate-950/80 px-3 py-2 text-left text-cyan-50 hover:border-cyan-200/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300 disabled:opacity-50"
        >
          <span id={`${id}-value`} className="min-w-0 truncate">
            {value.label}
          </span>
          <Combobox.Icon aria-hidden="true">⌄</Combobox.Icon>
        </Combobox.Trigger>
        <Combobox.Portal>
          <Combobox.Positioner sideOffset={8} align="start" className="z-[70]">
            <Combobox.Popup className="w-[max(var(--anchor-width),18rem)] max-w-[calc(100vw-2rem)] rounded-xl border border-cyan-200/15 bg-[var(--rr-surface-menu)] p-2 text-cyan-50 shadow-[var(--rr-shadow-elevated)]">
              <Combobox.Input
                aria-label={`Search ${label.toLowerCase()}`}
                placeholder={`Search ${label.toLowerCase()}…`}
                maxLength={200}
                className="mb-2 min-h-11 w-full min-w-0 rounded-lg border border-cyan-200/20 bg-slate-950/80 px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/50"
              />
              <Combobox.List
                aria-label={label}
                className="max-h-64 overflow-y-auto"
              >
                {(option: SearchSelectOption) => (
                  <Combobox.Item
                    key={option.value}
                    value={option}
                    className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm outline-none data-[highlighted]:bg-cyan-300/10 data-[highlighted]:text-cyan-50"
                  >
                    <Combobox.ItemIndicator className="w-4 shrink-0 text-lime-200">
                      ✓
                    </Combobox.ItemIndicator>
                    <span className="min-w-0 break-words">{option.label}</span>
                  </Combobox.Item>
                )}
              </Combobox.List>
              <div
                role="status"
                className="px-2 text-sm leading-6 text-slate-400"
              >
                {loading ? "Loading…" : message}
              </div>
              {hasMore ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-1 w-full"
                  disabled={loading}
                  onClick={onLoadMore}
                >
                  Show more
                </Button>
              ) : null}
            </Combobox.Popup>
          </Combobox.Positioner>
        </Combobox.Portal>
      </Combobox.Root>
    </div>
  );
}
