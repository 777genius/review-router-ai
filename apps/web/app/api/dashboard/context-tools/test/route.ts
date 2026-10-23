import { z } from "zod";
import {
  contextToolsPublicError,
  testDashboardContextConnection,
} from "../../../../../src/server/context-tools";
import { readContextToolsRequest } from "../../../../../src/server/context-tools-request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const schema = z
  .object({
    workspaceId: z.string().min(1).max(256),
    expectedVersion: z.number().int().positive().nullable(),
    definition: z.unknown(),
    secrets: z.record(z.string(), z.string()).optional(),
  })
  .strict();
const headers = { "Cache-Control": "no-store" };
const failure = (error: string, status: number) =>
  Response.json({ ok: false, tools: [], error }, { status, headers });
export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readContextToolsRequest(request);
    if (body instanceof Response) {
      const safe = (await body.json()) as { error: string };
      return failure(safe.error, body.status);
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) return failure("context_connection_invalid", 400);
    const { secrets, ...input } = parsed.data;
    return Response.json(
      await testDashboardContextConnection({
        ...input,
        ...(secrets === undefined ? {} : { secrets }),
      }),
      { headers },
    );
  } catch (error) {
    const safe = contextToolsPublicError(error);
    return failure(safe.error, safe.status);
  }
}
