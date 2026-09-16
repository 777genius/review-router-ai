"use client";

import { HostedPoolSettingsPanel } from "./hosted-pool-settings";
import {
  buildHostedPoolPreviewFlight,
  buildHostedPoolPreviewView,
  type HostedPoolPreviewScenario,
} from "./hosted-pool-preview-fixtures";

const noopAction = async () => ({ params: {} });

export function HostedPoolPreviewClient({
  scenario,
}: {
  readonly scenario: HostedPoolPreviewScenario;
}): React.ReactElement {
  const view = buildHostedPoolPreviewView(scenario);
  const previewDeviceLoginFlight = buildHostedPoolPreviewFlight(scenario);
  return (
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
  );
}
