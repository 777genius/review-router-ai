import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { publishReviewFindingsArtifact } from "../packages/features/review-publishing/src/application/use-cases/publish-review-findings-artifact.ts";
import {
  createReviewFindingsArtifact,
  stringifyReviewFindingsArtifact,
} from "../packages/features/review-publishing/src/domain/review-findings-artifact.ts";
import type {
  ReviewFinding,
  ReviewPublicationTarget,
} from "../packages/features/review-publishing/src/domain/review-publication.ts";
import { GitHubSummaryReviewPublisher } from "../packages/features/review-publishing/src/infrastructure/github/github-summary-review-publisher.ts";

// A finite canary for the real publisher. No model calls or repository writes.
const { values } = parseArgs({
  options: {
    origin: { type: "string", default: "https://reviewrouter.org" },
    repo: {
      type: "string",
      default: "777genius/rr-selfhost-direct-v2-e2e-20260730t120036z",
    },
    pr: { type: "string", default: "2" },
    output: { type: "string", default: "tmp/compact-review-e2e" },
    publish: { type: "boolean", default: false },
    keep: { type: "boolean", default: false },
    "base64-fixture": { type: "string" },
  },
});
assert.match(values.repo, /^777genius\/rr-[a-z0-9-]*e2e[a-z0-9-]*$/);
assert.match(values.pr, /^[1-9][0-9]*$/);
const origin = new URL(values.origin);
assert.equal(origin.protocol, "https:");
assert.equal(
  origin.username + origin.password + origin.search + origin.hash,
  "",
);
assert.equal(origin.pathname, "/");
const output = resolve(values.output);
await mkdir(output, { recursive: true });
const token = execFileSync(
  "gh",
  ["auth", "token", "--hostname", "github.com"],
  { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
).trim();
const api = async <T>(
  path: string,
  method = "GET",
  payload?: unknown,
): Promise<T> => {
  const response = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github.full+json",
      "content-type": "application/json",
    },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    signal: AbortSignal.timeout(30_000),
  });
  assert.ok(response.ok, `GitHub ${method} ${path}: HTTP ${response.status}`);
  return (response.status === 204 ? null : await response.json()) as T;
};
const pull = await api<{
  head: { sha: string };
  base: { sha: string; repo: { id: number } };
}>(`/repos/${values.repo}/pulls/${values.pr}`);
const target: ReviewPublicationTarget = {
  provider: "github",
  repositoryExternalId: String(pull.base.repo.id),
  repositoryFullName: values.repo,
  changeRequestExternalId: values.pr,
  headSha: pull.head.sha,
  baseSha: pull.base.sha,
};
const tree = await api<{ tree: { path: string; type: string }[] }>(
  `/repos/${values.repo}/git/trees/${target.headSha}?recursive=1`,
);
const file =
  tree.tree.find((item) => item.type === "blob" && item.path.startsWith("src/"))
    ?.path ?? "README.md";
const findings: ReviewFinding[] = [
  {
    fingerprint: "compact-comment-fixture-1",
    severity: "critical",
    title: "E2E fixture: preserve the customer filter",
    body: "Presentation fixture: removing the customer filter can expose another customer's records.\n\nFull agent-readable evidence: preserve the filter and verify cross-customer isolation. This is a formatting canary, not a model finding.",
    location: { filePath: file, newLine: 1 },
  },
];
const marker = "reviewrouter:compact-comment-e2e:v1";
const query = new URLSearchParams({
  state: "complete",
  variant: "first",
  critical: "1",
  major: "0",
  minor: "0",
  info: "0",
  theme: "light",
});
const imageUrl = `${origin.origin}/review-banner/v1.svg?${query}`;
const image = await fetch(imageUrl, { signal: AbortSignal.timeout(30_000) });
assert.equal(
  image.status,
  200,
  "public endpoint must be deployed before the canary",
);
assert.match(image.headers.get("content-type") ?? "", /^image\/svg\+xml/);
const svg = await image.text();
assert.match(svg, /1 critical/);
assert.doesNotMatch(svg, /customer|private|<script|foreignObject|<image/);
const etag = image.headers.get("etag");
assert.ok(etag);
const cached = await fetch(imageUrl, {
  headers: { "If-None-Match": etag },
  signal: AbortSignal.timeout(30_000),
});
assert.equal(cached.status, 304);
const unrelatedValidator = await fetch(imageUrl, {
  headers: { "If-None-Match": '"other,*,also"' },
  signal: AbortSignal.timeout(30_000),
});
assert.equal(unrelatedValidator.status, 200);
const invalidImage = await fetch(
  `${origin.origin}/review-banner/v1.svg?state=complete&variant=first&critical=-1`,
  { signal: AbortSignal.timeout(30_000) },
);
assert.equal(invalidImage.status, 400);
await writeFile(resolve(output, "banner.svg"), svg);
if (!values.publish) {
  console.log(
    "Endpoint checks passed. Pass --publish to run the disposable PR comment canary.",
  );
  process.exit(0);
}

let commentId: string | undefined;
const steps: string[] = [];
const publish = async (
  items: readonly ReviewFinding[],
  state: "complete" | "incomplete",
  bannerBaseUrl = origin.origin,
) => {
  const artifact = createReviewFindingsArtifact({
    generatedAt: new Date(),
    findings: items,
  });
  const result = await publishReviewFindingsArtifact(
    {
      target,
      marker,
      mode: "summary-only",
      artifactJson: stringifyReviewFindingsArtifact(artifact),
    },
    {
      publisher: new GitHubSummaryReviewPublisher({
        token,
        bannerBaseUrl,
        reviewState: state,
      }),
    },
  );
  const id = result.externalIds[0]?.split(":").at(-1);
  assert.ok(id);
  if (commentId)
    assert.equal(id, commentId, "all cases must update the same summary");
  commentId = id;
  // Retain recovery evidence before another remote mutation or assertion.
  await writeFile(
    resolve(output, "progress.json"),
    JSON.stringify(
      {
        repo: values.repo,
        pr: values.pr,
        commentId,
        state,
        reviewedHead: target.headSha,
        observedAt: new Date().toISOString(),
      },
      null,
      2,
    ) + "\n",
  );
  return api<{ id: number; body: string; body_html: string; html_url: string }>(
    `/repos/${values.repo}/issues/comments/${id}`,
  );
};
const initial = await publish(findings, "complete");
assert.ok(initial.body.startsWith(`<!-- ${marker} summary -->`));
assert.match(initial.body, /1 critical/);
assert.match(initial.body, /Full agent-readable evidence/);
assert.ok(initial.body.includes(`/blob/${target.headSha}/${file}#L1`));
assert.doesNotMatch(
  initial.body,
  /# ReviewRouter|## Summary|Release Notes|0 major|data:image/,
);
assert.match(initial.body_html, /<picture>/);
assert.match(initial.body_html, /width="100%"/);
assert.doesNotMatch(initial.body_html, /height="110"|alt="ReviewRouter"/);
assert.match(initial.body_html, /max-width: 600px/);
assert.match(initial.body_html, /<source[^>]+srcset=/);
const camo = new RegExp(
  '<img[^>]+src="(https://camo[.]githubusercontent[.]com/[^"]+)"',
)
  .exec(initial.body_html)?.[1]
  ?.replaceAll("&amp;", "&");
assert.ok(camo, "GitHub must keep the fallback img and proxy it through Camo");
const proxied = await fetch(camo, { signal: AbortSignal.timeout(45_000) });
assert.equal(proxied.status, 200, "real Camo image load");
assert.match(proxied.headers.get("content-type") ?? "", /^image\/svg\+xml/);
assert.match(await proxied.text(), /1 critical/);
const themedImages: string[] = [];
for (const source of initial.body_html.matchAll(
  /<source[^>]+srcset="([^"]+)"/g,
)) {
  const themedUrl = source[1]!.replaceAll("&amp;", "&");
  assert.match(themedUrl, /^https:\/\/camo\.githubusercontent\.com\//);
  const themed = await fetch(themedUrl, {
    signal: AbortSignal.timeout(45_000),
  });
  assert.equal(themed.status, 200, "theme-specific Camo image load");
  assert.match(await themed.text(), /1 critical/);
  themedImages.push(themedUrl);
}
assert.ok(themedImages.length > 0);
await writeFile(resolve(output, "github-comment.md"), initial.body);
await writeFile(resolve(output, "github-comment.html"), initial.body_html);
steps.push(
  "actual publisher artifact-to-comment; raw full text; exact head permalink; GitHub picture + img sanitization; real Camo SVG load",
);

if (values["base64-fixture"]) {
  const fixture = await readFile(resolve(values["base64-fixture"]));
  assert.ok(fixture.length < 20_000, "bounded real WebP fixture");
  assert.equal(fixture.toString("ascii", 0, 4), "RIFF");
  assert.equal(fixture.toString("ascii", 8, 12), "WEBP");
  const data = `data:image/webp;base64,${fixture.toString("base64")}`;
  // Probe GitHub's image transport directly; this payload is not a finding and
  // must not relax the product's finding-body limit to accommodate base64.
  const base64 = await api<{ body: string; body_html: string }>(
    `/repos/${values.repo}/issues/comments/${commentId}`,
    "PATCH",
    { body: `${initial.body}\n\n![ReviewRouter base64 canary](${data})` },
  );
  assert.ok(base64.body.includes(data));
  const img = base64.body_html.match(
    /<img\b[^>]*alt="ReviewRouter base64 canary"[^>]*>/,
  )?.[0];
  assert.ok(img, "GitHub kept the image element");
  assert.doesNotMatch(img, /\bsrc=/, "GitHub removed the data URL");
  await writeFile(resolve(output, "base64-sanitized.html"), base64.body_html);
  steps.push(
    "real WebP data URL in posted PR comment: raw body retained it, GitHub removed image src",
  );
}

const broken = await publish(
  findings,
  "complete",
  `${origin.origin}/e2e-unavailable-banner`,
);
assert.match(broken.body, /Full agent-readable evidence/);
assert.match(broken.body, /1 critical/);
assert.match(broken.body, /e2e-unavailable-banner/);
const unavailable = await fetch(
  `${origin.origin}/e2e-unavailable-banner/review-banner/v1.svg?${query}`,
  { signal: AbortSignal.timeout(30_000) },
);
assert.equal(unavailable.status, 404);
await writeFile(resolve(output, "unavailable-image.md"), broken.body);
steps.push(
  "unavailable image path does not prevent publication or readable text",
);
const incomplete = await publish([], "incomplete");
assert.match(incomplete.body, /Review incomplete/i);
assert.doesNotMatch(incomplete.body, /All Clear/i);
await writeFile(resolve(output, "incomplete.md"), incomplete.body);
await writeFile(resolve(output, "incomplete.html"), incomplete.body_html);
steps.push("zero-finding incomplete review remains visibly incomplete");
const many = await publish(
  Array.from({ length: 4 }, (_, i) => ({
    ...findings[0]!,
    fingerprint: `compact-comment-fixture-${i + 1}`,
    title: `E2E fixture ${i + 1}`,
  })),
  "complete",
);
assert.equal((many.body.match(/<details>/g) ?? []).length, 4);
assert.equal((many.body.match(/<\/details>/g) ?? []).length, 4);
await writeFile(resolve(output, "many.html"), many.body_html);
steps.push("four findings at one location remain four balanced compact blocks");
await publish(findings, "complete");
const comments = await api<{ id: number; body: string }[]>(
  `/repos/${values.repo}/issues/${values.pr}/comments?per_page=100`,
);
assert.equal(
  comments.filter((item) => item.body.startsWith(`<!-- ${marker} summary -->`))
    .length,
  1,
);
steps.push("repeated publication uses one comment id; no duplicate summary");
if (!values.keep)
  await api(`/repos/${values.repo}/issues/comments/${commentId}`, "DELETE");
const receipt = {
  observedAt: new Date().toISOString(),
  repo: values.repo,
  pr: Number(values.pr),
  reviewedHead: target.headSha,
  commentId,
  commentUrl: initial.html_url,
  cleanedUp: !values.keep,
  imageUrl,
  camoUrl: camo,
  themedImages,
  endpoint: {
    mime: image.headers.get("content-type"),
    etag,
    conditionalStatus: cached.status,
    invalidStatus: invalidImage.status,
  },
  steps,
  modelCalls: 0,
  repositoryWrites: 0,
};
await writeFile(
  resolve(output, "receipt.json"),
  JSON.stringify(receipt, null, 2) + "\n",
);
console.log(JSON.stringify(receipt, null, 2));
