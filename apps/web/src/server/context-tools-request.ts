import { resolveReviewRouterPublicWebUrl } from "./codex-seed-script-url";
const headers = { "Cache-Control": "no-store" };
export const invalidContextRequest = () =>
  Response.json(
    { error: "context_connection_invalid" },
    { status: 400, headers },
  );
/** Same dashboard CSRF/origin and streamed-byte boundary for saving and testing drafts. */
export async function readContextToolsRequest(
  request: Request,
): Promise<unknown | Response> {
  if (
    request.headers.get("content-type")?.split(";")[0]?.trim() !==
    "application/json"
  )
    return invalidContextRequest();
  const origin = request.headers.get("origin");
  if (origin) {
    let publicOrigin: string;
    try {
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
  const reader = request.body?.getReader();
  if (!reader) return invalidContextRequest();
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 32768) {
        await reader.cancel();
        return Response.json(
          { error: "context_request_too_large" },
          { status: 413, headers },
        );
      }
      chunks.push(value);
    }
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
    );
  } catch {
    return invalidContextRequest();
  } finally {
    reader.releaseLock();
  }
}
