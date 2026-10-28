import { createHash } from "node:crypto";

/** Shared cache/security policy for modern and legacy public image queries. */
export function reviewBannerSvgResponse(
  request: Request,
  svg: string | null,
): Response {
  if (svg === null) {
    return new Response("Invalid banner parameters", {
      status: 400,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "text/plain; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
  const etag = `"${createHash("sha256").update(svg).digest("hex")}"`;
  const headers = {
    "Content-Type": "image/svg+xml; charset=utf-8",
    "Cache-Control": "public, max-age=300, s-maxage=86400",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "X-Content-Type-Options": "nosniff",
    ETag: etag,
  };
  const cached = matchesValidator(request.headers.get("If-None-Match"), etag);
  return new Response(cached ? null : svg, {
    status: cached ? 304 : 200,
    headers,
  });
}

function matchesValidator(header: string | null, etag: string): boolean {
  if (header === null) return false;
  if (header.trim() === "*") return true;
  const values: string[] = [];
  let quoted = false;
  let start = 0;
  for (let index = 0; index < header.length; index += 1) {
    if (header[index] === '"') quoted = !quoted;
    if (header[index] === "," && !quoted) {
      values.push(header.slice(start, index));
      start = index + 1;
    }
  }
  if (quoted) return false;
  values.push(header.slice(start));
  return values.some((value) => value.trim().replace(/^W\//, "") === etag);
}
