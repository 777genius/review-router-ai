import type { Metadata } from "next";
import { listDashboardContextConnections } from "../../../../src/server/context-tools";
import { listDashboardMcpCatalogPresets } from "../../../../src/server/mcp-catalog";
import { createNoIndexPageMetadata } from "../../../seo";
import { NavigationContentReady } from "../../../navigation-feedback";
import { ContextConnectionsForm } from "../../context-tools/context-connections-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = createNoIndexPageMetadata({
  title: "Context tools",
  description: "Workspace HTTPS MCP connections.",
});

export default async function ContextToolsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.ReactElement> {
  const params = await searchParams;
  const workspaceId =
    typeof params?.workspaceId === "string" ? params.workspaceId : "";
  let connections: Awaited<ReturnType<typeof listDashboardContextConnections>> =
    [];
  let refused = false;
  try {
    if (!workspaceId || workspaceId.length > 256)
      throw new Error("context_admin_required");
    connections = await listDashboardContextConnections(workspaceId);
  } catch {
    refused = true;
  }
  return (
    <section
      id="dashboard-section-content"
      className="grid min-w-0 gap-6 text-slate-200"
    >
      <NavigationContentReady completionKey={`context-tools:${workspaceId}`} />
      <h1 className="text-2xl font-semibold">Context tools</h1>
      <p className="text-sm text-slate-400">
        Owner/admin managed HTTPS MCP connections. Requires OpenCodeReview
        through Account Gateway with Agentic context enabled. Choose approved
        tools separately in each review policy. Secret values are encrypted and
        never displayed.
      </p>
      {refused ? (
        <p role="alert">
          Workspace owner or admin access is required. Open these settings from
          your workspace Dashboard.
        </p>
      ) : (
        <ContextConnectionsForm
          key={workspaceId}
          workspaceId={workspaceId}
          connections={connections}
          catalog={listDashboardMcpCatalogPresets()}
        />
      )}
    </section>
  );
}
