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
  props: React.ComponentPropsWithRef<typeof BaseDialog.Popup>,
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

/**
 * The round close control in a dialog corner. Disabled while the dialog
 * must stay open, such as during a pending write.
 */
export function DialogCloseButton({
  label,
  disabled,
  className,
}: {
  readonly label: string;
  readonly disabled?: boolean;
  readonly className?: string;
}): React.ReactElement {
  return (
    <BaseDialog.Close
      aria-label={label}
      disabled={disabled}
      className={cn(
        "absolute right-4 top-4 z-10 inline-grid h-9 w-9 place-items-center rounded-full border border-cyan-200/15 bg-slate-950/75 text-cyan-100 transition hover:border-cyan-200/35 hover:bg-cyan-300/[0.08] hover:text-cyan-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
    >
      <span aria-hidden="true" className="relative h-4 w-4">
        <span className="absolute left-1/2 top-1/2 h-0.5 w-4 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-full bg-current" />
        <span className="absolute left-1/2 top-1/2 h-0.5 w-4 -translate-x-1/2 -translate-y-1/2 -rotate-45 rounded-full bg-current" />
      </span>
    </BaseDialog.Close>
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
  CloseButton: DialogCloseButton,
  Portal: DialogPortal,
  Backdrop: DialogBackdrop,
  Popup: DialogPopup,
  Title: DialogTitle,
  Description: DialogDescription,
  Footer: DialogFooter,
};
