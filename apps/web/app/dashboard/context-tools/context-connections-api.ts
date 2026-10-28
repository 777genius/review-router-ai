export type DiscoveredContextTool = { name: string; description?: string };
export type ContextConnectionRequest = {
  workspaceId: string;
  expectedVersion: number | null;
  definition: unknown;
  secrets?: Record<string, string>;
};
export type ContextConnectionResult = {
  ok: boolean;
  tools: DiscoveredContextTool[];
  error?: string;
};
export async function testContextConnectionRequest(
  input: ContextConnectionRequest,
  signal: AbortSignal,
): Promise<ContextConnectionResult> {
  const response = await fetch("/api/dashboard/context-tools/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal,
  });
  const result: ContextConnectionResult = await response.json();
  return response.ok && result.ok
    ? result
    : {
        ok: false,
        tools: [],
        error: result.error ?? "context_mcp_unavailable",
      };
}
export async function saveContextConnectionRequest(
  input: ContextConnectionRequest & { enabled: boolean },
): Promise<{ ok: boolean; conflict: boolean; error?: string }> {
  const response = await fetch("/api/dashboard/context-tools", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (response.ok) return { ok: true, conflict: false };
  let error: string | undefined;
  try {
    const body: { error?: unknown } = await response.json();
    if (typeof body.error === "string") error = body.error;
  } catch {
    /* Non-JSON infrastructure errors use a fixed safe fallback. */
  }
  return {
    ok: false,
    conflict: response.status === 409,
    ...(error ? { error } : {}),
  };
}
export function contextProbeErrorMessage(code?: string): string {
  switch (code) {
    case "context_connection_conflict":
      return "Configuration changed. Reload before testing or saving again.";
    case "context_github_secret_unavailable":
      return "GitHub secrets are available only during reviews and cannot be tested here. Use Dashboard secrets to test, or enter tool names manually.";
    case "context_secret_reentry_required":
      return "The endpoint or authentication changed. Re-enter every Dashboard secret to test or save this draft.";
    case "context_secret_invalid":
      return "Enter every Dashboard secret, or leave all fields empty to use unchanged stored credentials.";
    case "context_secret_unavailable":
      return "Stored credentials are unavailable. Re-enter every Dashboard secret and try again.";
    case "context_mcp_timeout":
      return "The MCP server did not respond in time. Check its HTTPS endpoint and try again, or enter tool names manually.";
    case "context_mcp_address_forbidden":
      return "This endpoint is not allowed. Use a publicly reachable HTTPS MCP server.";
    case "context_mcp_auth_required":
      return "The MCP server refused authentication. Check the authentication method and secret values.";
    case "context_mcp_discovery_limit":
      return "The server returned more tools than discovery can display. Enter the exact tool names manually and approve up to 20 tools.";
    case "context_mcp_protocol_invalid":
      return "This endpoint did not return a supported MCP tools list. Check the MCP URL, or enter tool names manually.";
    case "context_admin_required":
      return "Workspace owner or admin access is required to test this connection.";
    case "context_tools_unavailable":
      return "Connection testing is unavailable. You can still enter tool names manually.";
    case "context_connection_invalid":
      return "Check the connection ID, HTTPS URL, header templates and credential bindings in Advanced JSON.";
    default:
      return "Could not connect to the MCP server. Check the endpoint and authentication, or enter tool names manually.";
  }
}
