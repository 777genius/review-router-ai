"use client";

// Accordion follows the shadcn/ui "base" registry component (MIT,
// shadcn-ui/ui), built on Base UI and restyled with ReviewRouter's tokens.
import { Accordion as AccordionPrimitive } from "@base-ui/react/accordion";
import { cn } from "../utils/cn";

export function Accordion({
  className,
  ...props
}: AccordionPrimitive.Root.Props): React.ReactElement {
  return (
    <AccordionPrimitive.Root
      data-slot="accordion"
      className={cn(
        "flex w-full flex-col divide-y divide-cyan-200/10 rounded-2xl border border-cyan-200/12 bg-[var(--rr-surface-panel)]",
        className,
      )}
      {...props}
    />
  );
}

export function AccordionItem({
  className,
  ...props
}: AccordionPrimitive.Item.Props): React.ReactElement {
  return (
    <AccordionPrimitive.Item
      data-slot="accordion-item"
      className={cn("first:rounded-t-2xl last:rounded-b-2xl", className)}
      {...props}
    />
  );
}

export function AccordionTrigger({
  className,
  children,
  ...props
}: AccordionPrimitive.Trigger.Props): React.ReactElement {
  return (
    <AccordionPrimitive.Header className="flex">
      <AccordionPrimitive.Trigger
        data-slot="accordion-trigger"
        className={cn(
          "group/accordion-trigger flex flex-1 items-center justify-between gap-4 px-5 py-4 text-left text-sm font-semibold text-cyan-50 outline-none transition-colors hover:bg-cyan-300/[0.04] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-200/40",
          className,
        )}
        {...props}
      >
        {children}
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="size-4 shrink-0 text-slate-400 transition-transform duration-200 group-data-[panel-open]/accordion-trigger:rotate-180"
        >
          <path d="m4 6 4 4 4-4" />
        </svg>
      </AccordionPrimitive.Trigger>
    </AccordionPrimitive.Header>
  );
}

// keepMounted keeps closed answers in the server-rendered HTML so the page
// stays searchable and indexable; Base UI hides them with `hidden`.
export function AccordionContent({
  className,
  children,
  ...props
}: AccordionPrimitive.Panel.Props): React.ReactElement {
  return (
    <AccordionPrimitive.Panel
      data-slot="accordion-content"
      keepMounted
      className="h-[var(--accordion-panel-height)] overflow-hidden text-sm transition-[height] duration-200 ease-out data-[ending-style]:h-0 data-[starting-style]:h-0 motion-reduce:transition-none"
      {...props}
    >
      <div className={cn("px-5 pb-5 text-slate-400", className)}>
        {children}
      </div>
    </AccordionPrimitive.Panel>
  );
}
