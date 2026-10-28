import type React from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createNoIndexPageMetadata } from "../../seo";
import { readDashboardSearchParam } from "../dashboard-section";
import {
  ProviderListPreviewClient,
  type ProviderListPreviewState,
} from "../provider-setup/provider-list-preview-client";
import {
  ProviderSetupPreviewClient,
  type ProviderSetupPreviewState,
} from "../provider-setup/provider-setup-preview-client";
import { WorkspaceOtherSettings } from "../workspace-other-settings";

export const dynamic = "force-dynamic";

export const metadata: Metadata = createNoIndexPageMetadata({
  title: "Provider setup preview",
  description: "Fixture view of the provider setup dialog.",
});

type ProviderSetupPreviewPageProps = {
  readonly searchParams?: Promise<
    Record<string, string | string[] | undefined>
  >;
};

/**
 * Fixture-only visual review of the provider screens; off unless enabled.
 *
 * - `?state=default|no-default&viewer=owner|member&access=on|off`: the
 *   provider lines, the repository rows and the provider dialog (S5).
 * - `?screen=providers&list=several|empty&viewer=owner|member&access=on|off`:
 *   the Providers list.
 * - `?screen=other&viewer=owner|member&access=on|off`: Other with Access
 *   rights.
 */
export default async function ProviderSetupPreviewPage({
  searchParams,
}: ProviderSetupPreviewPageProps): Promise<React.ReactElement> {
  if (process.env.REVIEW_ROUTER_ENABLE_PROVIDER_SETUP_PREVIEW !== "1")
    notFound();
  const params = searchParams ? await searchParams : {};
  const param = (name: string) => readDashboardSearchParam(params[name]);
  const screen = param("screen");
  const viewer = param("viewer") === "member" ? "member" : "owner";
  const adminOnly = param("access") === "on";
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-5 px-4 py-6 sm:px-6 md:py-10">
      {screen === "providers" ? (
        <ProviderListPreviewClient
          state={
            {
              list: param("list") === "empty" ? "empty" : "several",
              viewer,
              adminOnly,
            } satisfies ProviderListPreviewState
          }
        />
      ) : screen === "other" ? (
        <div id="dashboard-section-content" className="min-w-0">
          <h2 className="text-2xl font-semibold text-cyan-50">Other</h2>
          <div id="access-rights">
            <WorkspaceOtherSettings
              workspaceId="preview-workspace"
              reviewDraftPullRequests
              providerManagementAdminOnly={adminOnly}
              canEdit={viewer === "owner"}
            />
          </div>
        </div>
      ) : (
        <ProviderSetupPreviewClient
          state={
            (param("state") === "no-default"
              ? "no-default"
              : "default") satisfies ProviderSetupPreviewState
          }
          viewer={{ role: viewer, adminOnly }}
        />
      )}
    </main>
  );
}
