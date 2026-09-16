import { Buffer } from "node:buffer";
import { createHash, verify, type KeyObject } from "node:crypto";
import {
  certifiedForkReviewModelOutputHash,
  parseCertifiedForkReviewModelOutput,
  parseCertifiedForkReviewPromptPacket,
  type CertifiedForkReviewModelOutput,
  type CertifiedForkReviewPromptPacket,
} from "../../../../packages/features/action-control-plane/src/application/use-cases/certified-fork-review-packet.js";
import { parseCertifiedForkReviewBinding } from "../../../../packages/features/action-control-plane/src/application/use-cases/certified-fork-review-binding.js";
import type {
  CertifiedForkReviewBinding,
  CertifiedForkReviewGatewayPort,
} from "../../../../packages/features/action-control-plane/src/application/ports/certified-fork-review-port.js";
import {
  opaqueId,
  counter,
} from "../../../../packages/features/action-control-plane/src/domain/certified-fork-effect-canonical.js";
import type { ForkCommandReceipt } from "../../../../packages/features/action-control-plane/src/application/ports/certified-fork-effect-repository-port.js";

/** INTERNAL, unused. Dependencies are protected composition, never request DTOs.
 * This adapter publishes one summary issue comment. It also inventories review
 * comments so a matching marker in another namespace cannot become a duplicate.
 * It does not produce domain witnesses, perform admission, or wire a route.
 */
export interface PublicationAppClient {
  request(
    route: string,
    parameters?: Record<string, unknown>,
  ): Promise<{
    data: unknown;
    status: number;
    headers: { link?: string };
  }>;
}
export interface PublicationInstallationApp {
  readonly octokit: PublicationAppClient;
  /** Must be the App installation factory, with retries disabled for mutations.
   * No caller tokens, auth overrides, retry plugins or automatic redispatch.
   */
  getInstallationOctokit(id: number): Promise<PublicationAppClient>;
}

export type PublicationRequest = Readonly<{
  commandId: string;
  commandHash: string;
  familyKey: string;
  reviewHash: string;
  effectKey: string;
  providerInstanceId: string;
  githubInstallationId: string;
  binding: CertifiedForkReviewBinding;
  packet: CertifiedForkReviewPromptPacket;
  output: CertifiedForkReviewModelOutput;
}>;
export type PublicationIdentity = Readonly<{
  commandId: string;
  commandHash: string;
  familyKey: string;
  reviewHash: string;
  effectKey: string;
  providerInstanceId: string;
  installationId: string;
  appId: string;
  botId: string;
  markerVersion: 1;
  binding: CertifiedForkReviewBinding;
  contextHash: string;
  outputHash: string;
  bodyHash: string;
}>;
export type PublicationTarget = Readonly<{
  kind: "issue" | "review";
  id: string;
  bodyHash: string;
}>;
export type PublicationIntent = Readonly<{
  identity: PublicationIdentity;
  receipt: ForkCommandReceipt;
  attemptId: string;
  target: PublicationTarget | null;
}>;
export type PublicationObservation =
  | Readonly<{ kind: "observed"; commentId: string; bodyHash: string }>
  | Readonly<{ kind: "uncertain" }>
  | Readonly<{ kind: "not-dispatched" }>;
export type PublicationConfirmation = Readonly<{
  identity: PublicationIdentity;
  receipt: ForkCommandReceipt;
  commentId: string;
}>;

/** Authoritative durable boundary. An implementation must use the existing
 * effect domain/repository and retained producer authentication, not a mutex,
 * caller booleans, matching labels, receipts parsed from JSON, or HMAC tickets.
 *
 * reserve authenticates retained output, complete publication inventory, current
 * admission/ownership and original command preimage/receipt. It atomically binds
 * the entire identity AND target, commits a consumed dispatch intent, then reads
 * and authenticates that committed intent before returning dispatch. Concurrent
 * callers and restarts must see pending (or original confirmation), never another
 * dispatch. A thrown/lost reserve ACK is unresolved, not permission to send.
 *
 * A second dispatch is permissible ONLY after separately authenticated definitive
 * no-effect evidence closes the prior attempt through the domain retry transition.
 * An empty listing, timeout, lease expiry, cancelled signal or not-dispatched
 * observation here is NOT that evidence. This sender has no retry/no-effect API.
 *
 * retain persists the observation with original receipt and attempt, authenticates
 * the committed outcome through retained proof custody, and returns confirmation
 * only when that proves the effect. HTTP success alone is not confirmation.
 * Recovery must authenticate the ORIGINAL receipt, even after the family advances.
 */
export interface DurablePublicationAuthorization {
  reserve(input: {
    identity: PublicationIdentity;
    target: PublicationTarget | null;
    inventory: readonly PublicationTarget[];
  }): Promise<
    | { kind: "dispatch"; intent: PublicationIntent }
    | { kind: "confirmed"; confirmation: PublicationConfirmation }
    | { kind: "pending" }
    | { kind: "refused" }
  >;
  retain(
    intent: PublicationIntent,
    observation: PublicationObservation,
  ): Promise<PublicationConfirmation | null>;
}
export type PublicationDisposition =
  | Readonly<{ kind: "confirmed"; commentId: string }>
  | Readonly<{ kind: "refused" }>
  | Readonly<{ kind: "reconciliation-required" }>;
export interface PublicationSenderDependencies {
  app: PublicationInstallationApp;
  appId: string;
  appSlug: string;
  botId: string;
  markerPublicKey: KeyObject;
  /** Protected Ed25519 marker signer; never an effect/admission witness issuer. */
  signMarker(payload: Buffer): Promise<Buffer>;
  currentness: Pick<CertifiedForkReviewGatewayPort, "assertBindingCurrent">;
  authorization: DurablePublicationAuthorization;
}

type Marker = Readonly<{
  identity: PublicationIdentity;
  receipt: ForkCommandReceipt;
  attemptId: string;
}>;
type Comment = Readonly<{
  target: PublicationTarget;
  body: string;
  authorId: string;
  authorType: string;
}>;
const prefix = "<!-- reviewrouter-certified-fork:v1:";
const refused = Object.freeze({ kind: "refused" } as const);
const pending = Object.freeze({ kind: "reconciliation-required" } as const);
const hex = /^[a-f0-9]{64}$/u;
const decimal = /^[1-9][0-9]*$/u;
const pageSize = 100;
const maxPages = 100;

function requireValue(value: unknown): asserts value {
  if (!value) throw new Error("certified_fork_publication_invalid");
}
function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
function numericId(value: unknown): string {
  requireValue(
    (typeof value === "number" && Number.isSafeInteger(value)) ||
      typeof value === "string",
  );
  const id = String(value);
  requireValue(decimal.test(id));
  return id;
}
function record(value: unknown): Record<string, unknown> {
  requireValue(
    value !== null && typeof value === "object" && !Array.isArray(value),
  );
  return value as Record<string, unknown>;
}
function receipt(value: ForkCommandReceipt): ForkCommandReceipt {
  opaqueId(value.commandId);
  requireValue(hex.test(value.commandHash) && hex.test(value.reviewHash));
  requireValue(hex.test(value.ownerHash));
  counter(value.version);
  return Object.freeze({
    ownerHash: value.ownerHash,
    commandId: value.commandId,
    commandHash: value.commandHash,
    reviewHash: value.reviewHash,
    version: value.version,
  });
}
function assertReceipt(
  value: ForkCommandReceipt,
  identity: PublicationIdentity,
) {
  const parsed = receipt(value);
  requireValue(
    parsed.commandId === identity.commandId &&
      parsed.commandHash === identity.commandHash &&
      parsed.reviewHash === identity.reviewHash,
  );
}
function identity(value: PublicationIdentity): PublicationIdentity {
  for (const id of [value.commandId, value.providerInstanceId]) opaqueId(id);
  for (const digest of [
    value.commandHash,
    value.familyKey,
    value.reviewHash,
    value.effectKey,
    value.contextHash,
    value.outputHash,
    value.bodyHash,
  ])
    requireValue(typeof digest === "string" && hex.test(digest));
  requireValue(value.markerVersion === 1);
  return Object.freeze({
    commandId: value.commandId,
    commandHash: value.commandHash,
    familyKey: value.familyKey,
    reviewHash: value.reviewHash,
    effectKey: value.effectKey,
    providerInstanceId: value.providerInstanceId,
    installationId: numericId(value.installationId),
    appId: numericId(value.appId),
    botId: numericId(value.botId),
    markerVersion: 1,
    binding: parseCertifiedForkReviewBinding(value.binding),
    contextHash: value.contextHash,
    outputHash: value.outputHash,
    bodyHash: value.bodyHash,
  });
}
function marker(value: Marker): Marker {
  opaqueId(value.attemptId);
  const parsed = identity(value.identity);
  assertReceipt(value.receipt, parsed);
  return Object.freeze({
    identity: parsed,
    receipt: receipt(value.receipt),
    attemptId: value.attemptId,
  });
}
function target(value: PublicationTarget | null): PublicationTarget | null {
  if (value === null) return null;
  requireValue(value.kind === "issue" || value.kind === "review");
  requireValue(hex.test(value.bodyHash));
  return Object.freeze({
    kind: value.kind,
    id: numericId(value.id),
    bodyHash: value.bodyHash,
  });
}
function scope(value: PublicationIdentity): string {
  return JSON.stringify([
    value.familyKey,
    value.reviewHash,
    value.effectKey,
    value.providerInstanceId,
    value.installationId,
    value.appId,
    value.botId,
    value.markerVersion,
    value.binding,
    value.contextHash,
  ]);
}
function confirm(
  value: PublicationConfirmation,
  expected: PublicationIdentity,
): PublicationDisposition {
  requireValue(same(identity(value.identity), expected));
  assertReceipt(value.receipt, expected);
  return Object.freeze({
    kind: "confirmed",
    commentId: numericId(value.commentId),
  });
}

/** All model text is data. Escape marker delimiters so model output cannot create
 * a second ownership marker. This is a bounded summary payload, not a renderer
 * integration or an inline-review implementation.
 */
function body(output: CertifiedForkReviewModelOutput): string {
  const text = [
    output.summaryMarkdown,
    ...output.findings.map(
      (finding) => `${finding.severity}: ${finding.title}\n\n${finding.body}`,
    ),
  ]
    .join("\n\n")
    .replaceAll("<!--", "&lt;!--");
  requireValue(Buffer.byteLength(text) <= 60_000);
  return text;
}
function ownedMarker(
  comment: Comment,
  deps: PublicationSenderDependencies,
): Marker | null {
  if (comment.authorId !== deps.botId || comment.authorType !== "Bot")
    return null;
  const start = comment.body.lastIndexOf(prefix);
  if (start < 0) return null;
  requireValue(comment.body.indexOf(prefix) === start);
  const suffix = comment.body.slice(start);
  const match =
    /^<!-- reviewrouter-certified-fork:v1:([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+) -->$/u.exec(
      suffix,
    );
  requireValue(match);
  const payload = Buffer.from(match[1]!, "base64url");
  const signature = Buffer.from(match[2]!, "base64url");
  requireValue(
    payload.toString("base64url") === match[1] &&
      signature.toString("base64url") === match[2],
  );
  requireValue(
    signature.length === 64 &&
      verify(null, payload, deps.markerPublicKey, signature),
  );
  const parsed = marker(JSON.parse(payload.toString("utf8")) as Marker);
  requireValue(JSON.stringify(parsed) === payload.toString("utf8"));
  requireValue(
    parsed.identity.appId === deps.appId &&
      parsed.identity.botId === deps.botId,
  );
  requireValue(start >= 2 && comment.body.slice(start - 2, start) === "\n\n");
  requireValue(
    parsed.identity.bodyHash === hash(comment.body.slice(0, start - 2)),
  );
  return parsed;
}
function parseComment(data: unknown, kind: "issue" | "review"): Comment {
  const raw = record(data);
  const user = record(raw.user);
  requireValue(typeof raw.body === "string" && typeof user.type === "string");
  requireValue(Buffer.byteLength(raw.body) <= 100_000);
  return Object.freeze({
    target: Object.freeze({
      kind,
      id: numericId(raw.id),
      bodyHash: hash(raw.body),
    }),
    body: raw.body,
    authorId: numericId(user.id),
    authorType: user.type,
  });
}

async function discover(
  client: PublicationAppClient,
  parameters: Record<string, unknown>,
  kind: "issue" | "review",
  signal?: AbortSignal,
): Promise<Comment[]> {
  const route =
    kind === "issue"
      ? "GET /repos/{owner}/{repo}/issues/{issue_number}/comments"
      : "GET /repos/{owner}/{repo}/pulls/{pull_number}/comments";
  const result: Comment[] = [];
  const seen = new Set<string>();
  let bytes = 0;
  let advertisedLast = 0;
  for (let page = 1; page <= maxPages; page++) {
    requireValue(!signal?.aborted);
    const response = await client.request(route, {
      ...parameters,
      per_page: pageSize,
      page,
      request: { signal, timeout: 15_000 },
    });
    requireValue(response.status === 200 && Array.isArray(response.data));
    requireValue(
      response.data.length <= pageSize && response.headers !== undefined,
    );
    const link = response.headers.link;
    // Validate every advertised next page against our fixed route. Never follow
    // arbitrary Link URLs with installation credentials. Full pages without Link
    // still require an explicit empty/short terminal page.
    if (link !== undefined) {
      requireValue(typeof link === "string");
      for (const part of link.split(",")) {
        const match = /^\s*<([^>]+)>;\s*rel="(next|prev|first|last)"\s*$/u.exec(
          part,
        );
        requireValue(match);
        const url = new URL(match[1]!);
        const section = kind === "issue" ? "issues" : "pulls";
        const number =
          kind === "issue" ? parameters.issue_number : parameters.pull_number;
        requireValue(
          url.origin === "https://api.github.com" &&
            url.pathname ===
              `/repos/${parameters.owner}/${parameters.repo}/${section}/${number}/comments` &&
            url.searchParams.get("per_page") === String(pageSize),
        );
        const linkedPage = Number(url.searchParams.get("page"));
        requireValue(
          Number.isSafeInteger(linkedPage) &&
            linkedPage > 0 &&
            linkedPage <= maxPages,
        );
        if (match[2] === "last")
          advertisedLast = Math.max(advertisedLast, linkedPage);
        if (match[2] === "next") {
          advertisedLast = Math.max(advertisedLast, linkedPage);
          requireValue(url.searchParams.get("page") === String(page + 1));
          requireValue(response.data.length === pageSize);
        }
      }
    }
    requireValue(response.data.length > 0 || page > advertisedLast);
    for (const raw of response.data) {
      const comment = parseComment(raw, kind);
      requireValue(!seen.has(comment.target.id));
      bytes += Buffer.byteLength(comment.body);
      requireValue(bytes <= 16_000_000);
      seen.add(comment.target.id);
      result.push(comment);
    }
    if (response.data.length < pageSize) {
      requireValue(page >= advertisedLast);
      return result;
    }
  }
  throw new Error("certified_fork_publication_inventory_incomplete");
}

/** Transport fuse only, NEVER durable authority. Octokit auth hooks can retry
 * 401s even without a retry plugin. A per-request fetch prevents their second
 * wire dispatch too; redirects are refused rather than transparently reposted.
 * The durable intent above remains consumed regardless of this local fuse.
 */
function singleDispatchFetch(): typeof fetch {
  const transport = globalThis.fetch;
  let invoked = false;
  return async (input, init) => {
    requireValue(!invoked);
    invoked = true;
    return transport(input, { ...init, redirect: "error" });
  };
}

/** One invocation can dispatch at most once. All outward errors are closed,
 * body-free dispositions; thrown upstream errors and response metadata never
 * escape. Intent uncertainty and any post-reservation failure require durable
 * reconciliation. No request cancellation is interpreted as remote absence.
 */
export async function sendCertifiedForkPublication(
  deps: PublicationSenderDependencies,
  input: PublicationRequest,
  signal?: AbortSignal,
): Promise<PublicationDisposition> {
  let reserved = false;
  let retentionAttempted = false;
  let intent: PublicationIntent | undefined;
  let observation: PublicationObservation = { kind: "not-dispatched" };
  try {
    if (signal?.aborted) return refused;
    requireValue(
      deps.markerPublicKey.type === "public" &&
        deps.markerPublicKey.asymmetricKeyType === "ed25519",
    );
    const binding = parseCertifiedForkReviewBinding(input.binding);
    const packet = parseCertifiedForkReviewPromptPacket(input.packet);
    requireValue(same(binding, packet.binding));
    const paths = packet.files.map((file) => file.path);
    const output = parseCertifiedForkReviewModelOutput(input.output, paths);
    const text = body(output);
    const expected = identity({
      commandId: input.commandId,
      commandHash: input.commandHash,
      familyKey: input.familyKey,
      reviewHash: input.reviewHash,
      effectKey: input.effectKey,
      providerInstanceId: input.providerInstanceId,
      installationId: input.githubInstallationId,
      appId: deps.appId,
      botId: deps.botId,
      markerVersion: 1,
      binding,
      contextHash: packet.contextHash,
      outputHash: certifiedForkReviewModelOutputHash(output, paths),
      bodyHash: hash(text),
    });
    const installation = Number(expected.installationId);
    requireValue(Number.isSafeInteger(installation));
    const app = await deps.app.octokit.request("GET /app");
    const appData = record(app.data);
    requireValue(
      app.status === 200 &&
        numericId(appData.id) === expected.appId &&
        appData.slug === deps.appSlug,
    );
    const client = await deps.app.getInstallationOctokit(installation);
    const installed = await deps.app.octokit.request(
      "GET /app/installations/{installation_id}",
      { installation_id: installation },
    );
    const installedData = record(installed.data);
    requireValue(
      installed.status === 200 &&
        numericId(installedData.id) === expected.installationId &&
        numericId(installedData.app_id) === expected.appId,
    );
    const bot = await client.request("GET /users/{username}", {
      username: `${deps.appSlug}[bot]`,
    });
    const botData = record(bot.data);
    requireValue(
      bot.status === 200 &&
        numericId(botData.id) === expected.botId &&
        botData.type === "Bot",
    );
    const current = () =>
      deps.currentness.assertBindingCurrent({
        githubInstallationId: expected.installationId,
        binding,
      });
    await current();
    const [owner, repo] = binding.baseRepository.split("/");
    const params = {
      owner,
      repo,
      issue_number: binding.pullRequestNumber,
      pull_number: binding.pullRequestNumber,
    };
    const comments = [
      ...(await discover(client, params, "issue", signal)),
      ...(await discover(client, params, "review", signal)),
    ];
    const candidates: Comment[] = [];
    for (const comment of comments) {
      const signed = ownedMarker(comment, deps);
      if (!signed || scope(signed.identity) !== scope(expected)) continue;
      if (signed.identity.commandId === expected.commandId)
        requireValue(same(signed.identity, expected));
      candidates.push(comment);
    }
    requireValue(candidates.length <= 1);
    const candidate = candidates[0];
    requireValue(!candidate || candidate.target.kind === "issue");
    if (signal?.aborted) return refused;
    await current();
    // reserve may commit and lose its ACK. Set uncertainty BEFORE awaiting it.
    reserved = true;
    const decision = await deps.authorization.reserve({
      identity: expected,
      target: candidate?.target ?? null,
      inventory: Object.freeze(comments.map((comment) => comment.target)),
    });
    if (decision.kind === "refused") return refused;
    if (decision.kind === "pending") return pending;
    if (decision.kind === "confirmed")
      return confirm(decision.confirmation, expected);
    const raw = decision.intent;
    const parsedMarker = marker(raw);
    const capturedIntent = Object.freeze({
      ...parsedMarker,
      target: target(raw.target),
    });
    requireValue(
      same(capturedIntent.identity, expected) &&
        same(capturedIntent.target, candidate?.target ?? null),
    );
    intent = capturedIntent;
    const payload = Buffer.from(JSON.stringify(parsedMarker));
    const signature = await deps.signMarker(payload);
    requireValue(
      signature.length === 64 &&
        verify(null, payload, deps.markerPublicKey, signature),
    );
    const publication = `${text}\n\n${prefix}${payload.toString("base64url")}.${signature.toString("base64url")} -->`;
    requireValue(Buffer.byteLength(publication) <= 65_536);
    if (candidate) {
      const response = await client.request(
        "GET /repos/{owner}/{repo}/issues/comments/{comment_id}",
        {
          owner,
          repo,
          comment_id: candidate.target.id,
          request: { signal, timeout: 15_000 },
        },
      );
      requireValue(response.status === 200);
      const fresh = parseComment(response.data, "issue");
      requireValue(
        same(fresh.target, candidate.target) && ownedMarker(fresh, deps),
      );
    }
    // Final guard follows ownership discovery, reservation, signing and target
    // re-read. No asynchronous work intervenes between this and dispatch.
    await current();
    requireValue(!signal?.aborted);
    observation = { kind: "uncertain" };
    const response = await client.request(
      candidate
        ? "PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}"
        : "POST /repos/{owner}/{repo}/issues/{issue_number}/comments",
      {
        owner,
        repo,
        issue_number: binding.pullRequestNumber,
        ...(candidate ? { comment_id: candidate.target.id } : {}),
        body: publication,
        request: {
          signal,
          timeout: 15_000,
          retries: 0,
          fetch: singleDispatchFetch(),
        },
      },
    );
    requireValue(!signal?.aborted);
    requireValue(response.status === (candidate ? 200 : 201));
    const sent = parseComment(response.data, "issue");
    requireValue(sent.body === publication && ownedMarker(sent, deps));
    requireValue(!candidate || sent.target.id === candidate.target.id);
    observation = {
      kind: "observed",
      commentId: sent.target.id,
      bodyHash: sent.target.bodyHash,
    };
    retentionAttempted = true;
    const retained = await deps.authorization.retain(intent, observation);
    if (!retained) return pending;
    requireValue(
      same(receipt(retained.receipt), intent.receipt) &&
        retained.commentId === sent.target.id,
    );
    return confirm(retained, expected);
  } catch {
    if (intent && !retentionAttempted) {
      // Best effort retention; a failed retention ACK must also be reconciled.
      // Never change an uncertain send into a no-effect claim.
      try {
        await deps.authorization.retain(intent, observation);
      } catch {
        /* redacted */
      }
    }
    return reserved ? pending : refused;
  }
}
