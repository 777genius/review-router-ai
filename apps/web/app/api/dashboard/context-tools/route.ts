import { z } from "zod";
import { readContextToolsRequest } from "../../../../src/server/context-tools-request";
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
  try {
    const body = await readContextToolsRequest(request);
    if (body instanceof Response) return body;
    const parsed = requestSchema.safeParse(body);
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
    const safe = contextToolsPublicError(error);
    return Response.json(
      { error: safe.error },
      { status: safe.status, headers },
    );
  }
}
