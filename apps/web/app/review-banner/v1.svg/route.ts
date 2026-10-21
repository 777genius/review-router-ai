import { reviewBannerResponse } from "./banner";

export const runtime = "nodejs";

export function GET(request: Request): Response {
  return reviewBannerResponse(request);
}
