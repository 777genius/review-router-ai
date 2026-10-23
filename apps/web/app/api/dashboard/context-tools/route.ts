import { z } from "zod";
import { resolveReviewRouterPublicWebUrl } from "../../../../src/server/codex-seed-script-url";
import {
  contextToolsPublicError,
  listDashboardContextConnections,
  saveDashboardContextConnection,
} from "../../../../src/server/context-tools";

export const dynamic = "force-dynamic";
const workspaceIdSchema = z.string().min(1).max(256);
const requestSchema = z
  .object({
    workspaceId: workspaceIdSchema,
    expectedVersion: z.number().int().positive().nullable(),
    definition: z.unknown(),
    enabled: z.boolean(),
    secrets: z.record(z.string(), z.string()).optional(),
  })
  .strict();
const headers = { "Cache-Control": "no-store" };
const invalid = () =>
  Response.json(
    { error: "context_connection_invalid" },
    { status: 400, headers },
  );

export async function GET(request: Request): Promise<Response> {
  const workspaceId = workspaceIdSchema.safeParse(
    new URL(request.url).searchParams.get("workspaceId"),
  );
  if (!workspaceId.success) return invalid();
  try {
    return Response.json(
      { connections: await listDashboardContextConnections(workspaceId.data) },
      { headers },
    );
  } catch (error) {
    const safe = contextToolsPublicError(error);
    return Response.json(
      { error: safe.error },
      { status: safe.status, headers },
    );
  }
}

export async function POST(request: Request): Promise<Response> {
  if (
    request.headers.get("content-type")?.split(";")[0]?.trim() !==
    "application/json"
  )
    return invalid();
  const origin = request.headers.get("origin");
  if (origin) {
    let publicOrigin: string;
    try {
      // The request URL can name the internal HTTP server behind a proxy.
      // Use validated deployment configuration, never forwarded host headers.
      publicOrigin = resolveReviewRouterPublicWebUrl();
    } catch {
      return Response.json(
        { error: "context_tools_unavailable" },
        { status: 503, headers },
      );
    }
    if (
      origin !== publicOrigin &&
      (process.env.NODE_ENV === "production" ||
        origin !== new URL(request.url).origin)
    )
      return Response.json(
        { error: "context_admin_required" },
        { status: 403, headers },
      );
  }
  // Enforce the bound on streamed bytes too; Content-Length is untrusted.
  const reader = request.body?.getReader();
  if (!reader) return invalid();
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 32_768) {
        await reader.cancel();
        return Response.json(
          { error: "context_request_too_large" },
          { status: 413, headers },
        );
      }
      chunks.push(value);
    }
    const parsed = requestSchema.safeParse(
      JSON.parse(Buffer.concat(chunks).toString("utf8")),
    );
    if (!parsed.success) return invalid();
    const { secrets, ...input } = parsed.data;
    return Response.json(
      {
        connection: await saveDashboardContextConnection({
          ...input,
          ...(secrets === undefined ? {} : { secrets }),
        }),
      },
      { headers },
    );
  } catch (error) {
    if (error instanceof SyntaxError) return invalid();
    const safe = contextToolsPublicError(error);
    return Response.json(
      { error: safe.error },
      { status: safe.status, headers },
    );
  } finally {
    reader.releaseLock();
  }
}
