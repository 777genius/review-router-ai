"use client";
import {
  Button,
  DialogBackdrop,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogPopup,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from "@reviewrouter/ui";
import type { ReactNode, RefObject } from "react";
export const skillFieldClass =
  "w-full rounded-lg border border-cyan-200/25 bg-slate-950/70 px-3 py-2 text-sm text-cyan-50 outline-none focus:border-cyan-200 focus:ring-2 focus:ring-cyan-300/20 disabled:opacity-50";
export const skillCellClass = "px-3 py-3 text-left align-top text-sm";
export const skillResponsiveCellClass =
  "block min-w-0 px-0 py-2 text-left align-top text-sm lg:table-cell lg:px-3 lg:py-3";
export const skillMobileLabelClass =
  "mb-1 block text-xs font-medium text-slate-400 lg:hidden";
export function SkillsError({ error }: { readonly error: unknown }) {
  return error ? (
    <p
      role="alert"
      className="rounded-lg border border-amber-300/30 p-3 text-sm leading-6 text-amber-100"
    >
      {error instanceof Error
        ? error.message
        : "This action could not be completed. Refresh and try again."}
    </p>
  ) : null;
}
export function SkillsDialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  feedback,
  pending = false,
  initialFocus,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: string;
  readonly description: string;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
  readonly feedback?: ReactNode;
  readonly pending?: boolean;
  readonly initialFocus?: RefObject<HTMLElement | null>;
}) {
  return (
    <DialogRoot
      open={open}
      onOpenChange={(next) => {
        if (!next && !pending) onClose();
      }}
    >
      <DialogPortal>
        <DialogBackdrop />
        <DialogPopup
          initialFocus={initialFocus}
          className="flex max-h-[calc(100dvh-1rem)] w-[min(96vw,64rem)] flex-col overflow-hidden p-0"
        >
          <div className="shrink-0 border-b border-cyan-200/15 p-5 pr-14">
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
            <DialogClose
              render={
                <button
                  type="button"
                  disabled={pending}
                  aria-label={`Close ${title}`}
                  className="absolute right-4 top-4 h-9 w-9 rounded-full border border-cyan-200/25 text-xl"
                />
              }
            >
              ×
            </DialogClose>
          </div>
          <div className="min-h-0 space-y-4 overflow-y-auto p-5">
            {children}
          </div>
          <div className="shrink-0 border-t border-cyan-200/15 bg-[var(--rr-surface-menu)] p-4">
            {feedback ? <div className="mb-3 space-y-2">{feedback}</div> : null}
            <DialogFooter className="m-0">
              {footer}
              <Button
                type="button"
                variant="ghost"
                disabled={pending}
                onClick={onClose}
              >
                Close
              </Button>
            </DialogFooter>
          </div>
        </DialogPopup>
      </DialogPortal>
    </DialogRoot>
  );
}
export function SkillSearch({
  value,
  onChange,
  label = "Search skills",
  placeholder = "Name or description",
  disabled = false,
  inputRef,
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly label?: string;
  readonly placeholder?: string;
  readonly disabled?: boolean;
  readonly inputRef?: RefObject<HTMLInputElement | null>;
}) {
  return (
    <label className="block text-sm text-slate-300">
      {label}
      <input
        ref={inputRef}
        type="search"
        className={`${skillFieldClass} mt-2`}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
    </label>
  );
}
