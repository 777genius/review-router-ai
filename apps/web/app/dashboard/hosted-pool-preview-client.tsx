"use client";

import { DashboardCollapsibleShell } from "./dashboard-collapsible-shell";
import {
  DASHBOARD_SECTIONS,
  dashboardSectionHref,
  dashboardSectionMeta,
} from "./dashboard-section";
import { DashboardSectionTabs } from "./dashboard-section-tabs";
import { HostedPoolSettingsPanel } from "./hosted-pool-settings";
import { HostedSessionEncryptionBadge } from "./hosted-session-encryption-mark";
import {
  buildHostedPoolPreviewFlight,
  buildHostedPoolPreviewView,
  type HostedPoolPreviewScenario,
} from "./hosted-pool-preview-fixtures";

const noopAction = async () => ({ params: {} });

const dashboardNavItems = DASHBOARD_SECTIONS.map((section) => ({
  section,
  label: dashboardSectionMeta[section].title,
  description: dashboardSectionMeta[section].navDescription,
  href: dashboardSectionHref(section),
}));

export function HostedPoolPreviewClient({
  scenario,
}: {
  readonly scenario: HostedPoolPreviewScenario;
}): React.ReactElement {
  const view = buildHostedPoolPreviewView(scenario);
  const previewDeviceLoginFlight = buildHostedPoolPreviewFlight(scenario);
  const setup = dashboardSectionMeta.setup;
  return (
    <DashboardCollapsibleShell nav={<PreviewDashboardNav />}>
      <div id="dashboard-section-content" className="min-w-0 space-y-5">
        <section className="rounded-[1.5rem] border border-cyan-200/10 bg-slate-950/62 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
          <p className="font-mono text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-cyan-100">
            {setup.eyebrow}
          </p>
          <h2 className="mt-2 text-2xl font-bold tracking-[-0.025em] text-cyan-50 sm:text-3xl">
            {setup.title}
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
            {setup.description}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <HostedSessionEncryptionBadge label="Encrypted at rest" />
          </div>
        </section>
        <HostedPoolSettingsPanel
          workspaceId="workspace-preview"
          mutationsEnabled
          view={view}
          {...(previewDeviceLoginFlight ? { previewDeviceLoginFlight } : {})}
          actions={{
            importAccount: noopAction,
            setAccountState: noopAction,
            removeAccount: noopAction,
            setRepositorySource: noopAction,
            startDeviceLogin: async () => ({
              ok: true,
              loginId: "preview-login",
              userCode: "ABCD-EFGH",
              verificationUrl: "https://auth.openai.com/codex/device",
              expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
              intervalSeconds: 60,
            }),
            pollDeviceLogin: async () => ({
              ok: true,
              status: "pending",
              loginId: "preview-login",
              userCode: "ABCD-EFGH",
              verificationUrl: "https://auth.openai.com/codex/device",
              expiresAt: new Date(Date.now() + 14 * 60_000).toISOString(),
            }),
          }}
        />
      </div>
    </DashboardCollapsibleShell>
  );
}

function PreviewDashboardNav(): React.ReactElement {
  return (
    <aside className="min-w-0 px-1 py-1 lg:p-5">
      <nav
        aria-label="Dashboard sections"
        className="flex gap-1 overflow-x-auto lg:hidden"
      >
        {dashboardNavItems.map((item) => {
          const active = item.section === "setup";
          return (
            <a
              key={item.section}
              href={item.href}
              title={item.description}
              aria-current={active ? "page" : undefined}
              className={[
                "inline-flex shrink-0 items-center whitespace-nowrap rounded-lg border px-3 py-1.5 font-mono text-[0.68rem] font-semibold uppercase tracking-[0.16em] transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300",
                active
                  ? "border-cyan-300/45 bg-cyan-300/[0.11] text-cyan-50"
                  : "border-transparent text-slate-300 hover:border-cyan-200/20 hover:bg-cyan-300/[0.055] hover:text-cyan-100",
              ].join(" ")}
            >
              {item.label}
            </a>
          );
        })}
      </nav>
      <div className="hidden lg:sticky lg:top-24 lg:grid">
        <DashboardSectionTabs
          items={dashboardNavItems}
          selectedSection="setup"
        />
      </div>
    </aside>
  );
}
