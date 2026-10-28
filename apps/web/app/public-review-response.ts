import { readFile } from "node:fs/promises";
import { join } from "node:path";

const documentFiles = {
  terms: "terms.html",
  privacy: "privacy.html",
  pricing: "pricing.html",
  "refund-policy": "refund-policy.html",
} as const;

type PublicReviewDocument = keyof typeof documentFiles;

export async function servePublicReviewDocument(
  document: PublicReviewDocument,
): Promise<Response> {
  // The web package is the cwd for both pnpm web:start and Next development.
  // Route handlers select a fixed document; request input never becomes a path.
  const html = await readFile(
    join(process.cwd(), "public", "paddle-review", documentFiles[document]),
    "utf8",
  );
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
}
