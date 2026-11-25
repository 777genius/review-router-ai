import { z } from "zod";
import { exportDashboardMemoryKnowledge } from "../../../../../src/server/dashboard-memory-knowledge";
import { memoryDashboardPublicError } from "../../../../../src/features/memory/adapters/memory-dashboard-controller";

export const dynamic = "force-dynamic";
export const revalidate = 0;
const headers = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Cookie",
};
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,160}$/);
export async function GET(request: Request): Promise<Response> {
  const query = new URL(request.url).searchParams;
  if ([...query.keys()].some((key) => query.getAll(key).length !== 1))
    return Response.json(
      { error: "memory_invalid_input" },
      { status: 400, headers },
    );
  const parsed = z
    .object({
      workspaceId: id,
      repositoryId: id.nullable(),
      cursor: z.string().max(512).optional(),
    })
    .strict()
    .safeParse({
      ...Object.fromEntries(query),
      repositoryId: query.get("repositoryId") || null,
    });
  if (!parsed.success)
    return Response.json(
      { error: "memory_invalid_input" },
      { status: 400, headers },
    );
  try {
    const result = await exportDashboardMemoryKnowledge({
      workspaceId: parsed.data.workspaceId,
      repositoryId: parsed.data.repositoryId,
      ...(parsed.data.cursor ? { cursor: parsed.data.cursor } : {}),
    });
    return Response.json(result, {
      headers: {
        ...headers,
        "Content-Disposition": `attachment; filename="reviewrouter-memory-${parsed.data.workspaceId}.json"`,
      },
    });
  } catch (error) {
    const safe = memoryDashboardPublicError(error);
    return Response.json(
      { error: safe.error },
      { status: safe.status, headers },
    );
  }
}
