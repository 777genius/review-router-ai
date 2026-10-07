"use client";

import Link from "next/link";

import { Tabs } from "@base-ui/react/tabs";
import {
  Activity,
  Brain,
  Cpu,
  GitPullRequest,
  Settings2,
  type LucideIcon,
} from "lucide-react";
import { useNavigationFeedback } from "../navigation-feedback";
import { dashboardClientNavigationHref } from "./dashboard-section";

const dashboardSectionIcons: Record<string, LucideIcon> = {
  repositories: GitPullRequest,
  memory: Brain,
  setup: Settings2,
  policy: Cpu,
  diagnostics: Activity,
};

export type DashboardSectionTabItem = {
  readonly section: string;
  readonly label: string;
  readonly description: string;
  readonly href: string;
};

export function DashboardSectionIcon({
  section,
  className = "h-4 w-4 shrink-0 text-current opacity-80",
}: {
  readonly section: string;
  readonly className?: string;
}): React.ReactElement {
  const Icon = dashboardSectionIcons[section] ?? Settings2;
  return (
    <Icon
      aria-hidden="true"
      data-section-icon={section}
      className={className}
    />
  );
}

export function DashboardSectionCompactNav({
  items,
  selectedSection,
}: {
  readonly items: readonly DashboardSectionTabItem[];
  readonly selectedSection: string;
}): React.ReactElement {
  const { startNavigation } = useNavigationFeedback();
  return (
    <nav
      aria-label="Dashboard sections"
      className="flex gap-1 overflow-x-auto lg:hidden"
    >
      {items.map((item) => {
        const active = selectedSection === item.section;
        const href = dashboardClientNavigationHref(item.href);
        return (
          <Link
            key={item.section}
            href={href}
            scroll={false}
            data-navigation-feedback="ignore"
            onNavigate={() => startNavigation(href)}
            title={item.description}
            aria-current={active ? "page" : undefined}
            className={[
              "inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg border px-3 py-1.5 font-mono text-[0.68rem] font-semibold uppercase tracking-[0.16em] transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300",
              active
                ? "border-cyan-300/45 bg-cyan-300/[0.11] text-cyan-50"
                : "border-transparent text-slate-300 hover:border-cyan-200/20 hover:bg-cyan-300/[0.055] hover:text-cyan-100",
            ].join(" ")}
          >
            <DashboardSectionIcon
              section={item.section}
              className="h-3.5 w-3.5 shrink-0 text-current opacity-80"
            />
            {item.label}
            {item.section === "memory" ? (
              <span className="rounded-full border border-amber-300/30 px-1.5 py-0.5 text-[0.55rem] tracking-[0.08em] text-amber-200">
                In development
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

export function DashboardSectionTabs({
  items,
  selectedSection,
}: {
  readonly items: readonly DashboardSectionTabItem[];
  readonly selectedSection: string;
}): React.ReactElement {
  const { startNavigation } = useNavigationFeedback();
  return (
    <Tabs.Root value={selectedSection} orientation="vertical">
      <Tabs.List
        aria-label="Dashboard sections"
        activateOnFocus
        className="grid gap-1 border-l border-cyan-200/15 pl-3"
      >
        {items.map((item) => {
          const href = dashboardClientNavigationHref(item.href);
          return (
            <Tabs.Tab
              key={item.section}
              value={item.section}
              nativeButton={false}
              render={
                <Link
                  href={href}
                  scroll={false}
                  data-navigation-feedback="ignore"
                  onNavigate={() => startNavigation(href)}
                  title={item.description}
                  aria-current={
                    selectedSection === item.section ? "page" : undefined
                  }
                />
              }
              className={({ active }) =>
                [
                  "group relative -ml-[0.82rem] grid min-h-14 border-l-2 px-4 py-2.5 text-left transition duration-200 ease-out hover:translate-x-0.5 hover:saturate-125 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200 active:translate-x-0",
                  active
                    ? "border-cyan-200 text-cyan-50"
                    : "border-transparent text-slate-300 hover:border-cyan-300/35 hover:text-cyan-50",
                ].join(" ")
              }
            >
              <span className="flex items-start gap-3">
                <DashboardSectionIcon
                  section={item.section}
                  className="mt-0.5 h-4 w-4 shrink-0 text-current opacity-80"
                />
                <span className="grid min-w-0">
                  <span className="font-mono text-[0.68rem] font-semibold uppercase tracking-[0.16em]">
                    {item.label}
                  </span>
                  {item.section === "memory" ? (
                    <span className="mt-1 w-fit rounded-full border border-amber-300/30 px-1.5 py-0.5 font-mono text-[0.58rem] font-semibold uppercase tracking-[0.08em] text-amber-200">
                      In development
                    </span>
                  ) : null}
                  {item.section === "memory" ? null : (
                    <span className="mt-1 overflow-hidden text-xs leading-4 text-slate-500 [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] group-hover:text-slate-300 group-data-[active]:text-cyan-100/80">
                      {item.description}
                    </span>
                  )}
                </span>
              </span>
            </Tabs.Tab>
          );
        })}
      </Tabs.List>
    </Tabs.Root>
  );
}
