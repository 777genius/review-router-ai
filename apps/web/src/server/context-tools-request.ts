import { resolveReviewRouterPublicWebUrl } from "./codex-seed-script-url";
import {
  readBoundedRequestJson,
  RequestBodyTooLargeError,
} from "./bounded-request-body";
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
  try {
    return await readBoundedRequestJson(request, 32768);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError)
      return Response.json(
        { error: "context_request_too_large" },
        { status: 413, headers },
      );
    return invalidContextRequest();
  }
}
