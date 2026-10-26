import { z } from "zod";
import { resolveReviewRouterPublicWebUrl } from "../../../../src/server/codex-seed-script-url";
import {
  loadDashboardMemoryKnowledge,
  mutateDashboardMemoryKnowledge,
  readDashboardMemoryOperation,
} from "../../../../src/server/dashboard-memory-knowledge";
import { memoryDashboardPublicError } from "../../../../src/features/memory/adapters/memory-dashboard-controller";

export const dynamic = "force-dynamic";
export const revalidate = 0;
const headers = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Cookie",
};
const reference = z.string().regex(/^[a-zA-Z0-9_-]{1,160}$/);
const selection = {
  workspaceId: reference,
  repositoryId: reference.nullable(),
};
const common = {
  ...selection,
  commandId: z.uuid(),
  entryId: reference.nullable(),
  expectedRevision: z.string().min(1).max(160).nullable(),
};
const mutation = z.discriminatedUnion("action", [
  z
    .object({
      ...common,
      action: z.literal("save"),
      body: z.string().trim().min(1).max(1_000),
      topics: z
        .array(
          z
            .string()
            .regex(/^[a-zA-Z0-9_-]{1,100}$/)
            .refine((value) => !value.startsWith("rr_")),
        )
        .max(20),
    })
    .strict(),
  z.object({ ...common, action: z.enum(["retire", "forget"]) }).strict(),
]);
const invalid = () =>
  Response.json({ error: "memory_invalid_input" }, { status: 400, headers });
export async function GET(request: Request): Promise<Response> {
  try {
    const query = new URL(request.url).searchParams;
    if ([...query.keys()].some((key) => query.getAll(key).length !== 1))
      return invalid();
    const parsed = z
      .object({
        ...selection,
        commandId: z.uuid().optional(),
        cursor: z.string().max(512).optional(),
        topicId: z
          .string()
          .regex(/^[a-zA-Z0-9_-]{1,100}$/)
          .optional(),
      })
      .strict()
      .safeParse({
        ...Object.fromEntries(query),
        repositoryId: query.get("repositoryId") || null,
      });
    if (!parsed.success) return invalid();
    return Response.json(
      parsed.data.commandId
        ? await readDashboardMemoryOperation({
            ...parsed.data,
            commandId: parsed.data.commandId,
          })
        : await loadDashboardMemoryKnowledge({
            workspaceId: parsed.data.workspaceId,
            repositoryId: parsed.data.repositoryId,
            ...(parsed.data.cursor ? { cursor: parsed.data.cursor } : {}),
            ...(parsed.data.topicId ? { topicId: parsed.data.topicId } : {}),
          }),
      { headers },
    );
  } catch (error) {
    const safe = memoryDashboardPublicError(error);
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
    let expected: string;
    try {
      expected = resolveReviewRouterPublicWebUrl();
    } catch {
      return Response.json(
        { error: "memory_unavailable" },
        { status: 503, headers },
      );
    }
    if (
      origin !== expected &&
      (process.env.NODE_ENV === "production" ||
        origin !== new URL(request.url).origin)
    )
      return Response.json(
        { error: "memory_forbidden" },
        { status: 403, headers },
      );
  }
  const reader = request.body?.getReader();
  if (!reader) return invalid();
  try {
    let bytes = 0;
    const chunks: Uint8Array[] = [];
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > 8_192) {
        await reader.cancel();
        return Response.json(
          { error: "memory_invalid_input" },
          { status: 413, headers },
        );
      }
      chunks.push(next.value);
    }
    const parsed = mutation.safeParse(
      JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
      ),
    );
    if (!parsed.success) return invalid();
    return Response.json(await mutateDashboardMemoryKnowledge(parsed.data), {
      headers,
    });
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof TypeError)
      return invalid();
    const safe = memoryDashboardPublicError(error);
    return Response.json(
      { error: safe.error },
      { status: safe.status, headers },
    );
  } finally {
    reader.releaseLock();
  }
}
