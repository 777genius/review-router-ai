"use client";
import {
  createContext,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Button } from "@reviewrouter/ui";
import { MoreHorizontal } from "lucide-react";

export const accountMenuItemClass =
  "w-full justify-start rounded-xl px-3 text-left";

const MenuContext = createContext<{
  trigger: React.RefObject<HTMLButtonElement | null>;
  close(): void;
} | null>(null);
export function useAccountMenuReturnFocus() {
  return useContext(MenuContext)?.trigger;
}
export function AccountMenuItem({
  children,
}: {
  children: React.ReactElement;
}) {
  const menu = useContext(MenuContext);
  return menu ? (
    <DropdownMenu.Item
      asChild
      onSelect={(event) => {
        event.preventDefault();
        menu.close();
      }}
    >
      {children}
    </DropdownMenu.Item>
  ) : (
    children
  );
}
export function AccountActionsMenu({
  label,
  children,
  triggerContent,
}: {
  label: string;
  children: ReactNode;
  triggerContent?: ReactNode;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [dialogContainer, setDialogContainer] = useState<HTMLElement | null>(
    null,
  );
  return (
    <MenuContext.Provider value={{ trigger, close: () => setOpen(false) }}>
      <DropdownMenu.Root
        modal={false}
        open={open}
        onOpenChange={(value) => {
          if (value)
            setDialogContainer(
              trigger.current?.closest<HTMLElement>('[role="dialog"]') ?? null,
            );
          setOpen(value);
        }}
      >
        <DropdownMenu.Trigger asChild>
          <Button
            ref={trigger}
            variant="ghost"
            size="sm"
            aria-label={triggerContent ? label : `Actions for ${label}`}
          >
            {triggerContent ?? (
              <MoreHorizontal aria-hidden="true" className="size-4" />
            )}
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal
          container={dialogContainer ?? undefined}
          forceMount
        >
          <DropdownMenu.Content
            forceMount
            hidden={!open}
            onInteractOutside={(event) => {
              // Content stays mounted to preserve the action dialogs. Focusing
              // its own trigger during pointerdown must not dismiss the menu.
              const target = event.detail.originalEvent.target;
              if (target instanceof Node && trigger.current?.contains(target))
                event.preventDefault();
            }}
            onCloseAutoFocus={(event) => {
              if (document.querySelector('[role="dialog"]'))
                event.preventDefault();
            }}
            align="end"
            {...(dialogContainer
              ? { collisionBoundary: dialogContainer, collisionPadding: 8 }
              : {})}
            sideOffset={8}
            className={`${dialogContainer ? "z-[70]" : "z-50"} data-[state=closed]:hidden grid min-w-56 max-w-[min(20rem,calc(100vw-2rem))] gap-1 rounded-xl border border-cyan-200/20 bg-[var(--rr-surface-menu)] p-2 text-cyan-50 shadow-lg shadow-black/40`}
          >
            {children}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </MenuContext.Provider>
  );
}
