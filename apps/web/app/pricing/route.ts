import { servePublicReviewDocument } from "../public-review-response";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  return servePublicReviewDocument("pricing");
}
