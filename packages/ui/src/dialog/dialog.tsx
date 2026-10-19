"use client";

import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { cn } from "../utils/cn";

export const DialogRoot = BaseDialog.Root;
export const DialogTrigger = BaseDialog.Trigger;
export const DialogClose = BaseDialog.Close;
export const DialogPortal = BaseDialog.Portal;

// Shared dialog chrome: layering, bounded scrolling height, and heading
// typography live here so panels never repeat them. Call sites override any
// default through className; tailwind-merge keeps the last conflicting utility.
export function DialogBackdrop(
  props: React.ComponentPropsWithoutRef<typeof BaseDialog.Backdrop>,
): React.ReactElement {
  return (
    <BaseDialog.Backdrop
      {...props}
      className={cn(
        "fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm",
        props.className,
      )}
    />
  );
}

export function DialogPopup(
  props: React.ComponentPropsWithoutRef<typeof BaseDialog.Popup>,
): React.ReactElement {
  return (
    <BaseDialog.Popup
      {...props}
      className={cn(
        "fixed left-1/2 top-1/2 z-[61] max-h-[calc(100dvh-2rem)] w-[min(92vw,560px)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-cyan-200/20 bg-[var(--rr-surface-menu)] p-6 text-cyan-50 shadow-[var(--rr-shadow-glow-cyan)] backdrop-blur-2xl",
        props.className,
      )}
    />
  );
}

export function DialogTitle(
  props: React.ComponentPropsWithoutRef<typeof BaseDialog.Title>,
): React.ReactElement {
  return (
    <BaseDialog.Title
      {...props}
      className={cn("text-lg font-semibold", props.className)}
    />
  );
}

export function DialogDescription(
  props: React.ComponentPropsWithoutRef<typeof BaseDialog.Description>,
): React.ReactElement {
  return (
    <BaseDialog.Description
      {...props}
      className={cn("mt-2 text-sm text-slate-400", props.className)}
    />
  );
}

export function DialogFooter(
  props: React.ComponentPropsWithoutRef<"div">,
): React.ReactElement {
  return (
    <div
      {...props}
      className={cn("mt-5 flex flex-wrap justify-end gap-3", props.className)}
    />
  );
}

export const Dialog = {
  Root: DialogRoot,
  Trigger: DialogTrigger,
  Close: DialogClose,
  Portal: DialogPortal,
  Backdrop: DialogBackdrop,
  Popup: DialogPopup,
  Title: DialogTitle,
  Description: DialogDescription,
  Footer: DialogFooter,
};
