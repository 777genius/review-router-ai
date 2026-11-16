"use client";

// Tabs follow the shadcn/ui "base" registry component (MIT, shadcn-ui/ui),
// built on Base UI and restyled with ReviewRouter's own surface tokens.
import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { cn } from "../utils/cn";

export function Tabs({
  className,
  ...props
}: TabsPrimitive.Root.Props): React.ReactElement {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn("flex flex-col gap-6", className)}
      {...props}
    />
  );
}

export function TabsList({
  className,
  ...props
}: TabsPrimitive.List.Props): React.ReactElement {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        "relative inline-flex w-fit max-w-full items-center gap-1 overflow-x-auto rounded-xl border border-cyan-200/12 bg-[var(--rr-surface-panel)] p-1",
        className,
      )}
      {...props}
    />
  );
}

export function TabsTrigger({
  className,
  ...props
}: TabsPrimitive.Tab.Props): React.ReactElement {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(
        "relative inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-transparent px-4 py-2 font-mono text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-slate-400 outline-none transition-colors hover:text-cyan-50 focus-visible:border-cyan-200/60 focus-visible:ring-2 focus-visible:ring-cyan-200/30 data-[active]:bg-cyan-300/[0.1] data-[active]:text-cyan-50 data-[active]:shadow-[inset_0_0_0_1px_rgba(103,232,249,0.28)] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({
  className,
  ...props
}: TabsPrimitive.Panel.Props): React.ReactElement {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-content"
      className={cn(
        "flex-1 outline-none focus-visible:ring-2 focus-visible:ring-cyan-200/30",
        className,
      )}
      {...props}
    />
  );
}
