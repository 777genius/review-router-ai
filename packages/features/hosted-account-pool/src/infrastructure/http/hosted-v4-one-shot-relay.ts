import { createHash, randomUUID } from "node:crypto";
import {
  assertHostedV4OneShotApproval,
  type HostedV4OneShotApproval,
} from "../../domain/hosted-v4-relay-grant";
import type {
  HostedV4DispatchLease,
  HostedV4RelayDispatchPort,
  HostedV4RelayTurnPort,
} from "../../application/ports/hosted-v4-relay-turn-port";
import type {
  AuthorizedHostedV4Relay,
  HostedV4RelayAuthorizationPort,
} from "../../interface/http/register-hosted-codex-relay-routes";
import type { HostedCodexSessionRuntime } from "../runtime/hosted-codex-session-runtime";

export type AuthorizedHostedV4OneShot = Omit<
  AuthorizedHostedV4Relay,
  "requestId"
> &
  Readonly<{
    runId: string;
    runAttempt: number;
  }>;
export interface HostedV4OneShotAuthorizationPort {
  authorize(
    input: Parameters<HostedV4RelayAuthorizationPort["authorize"]>[0],
  ): Promise<AuthorizedHostedV4OneShot>;
}
export type HostedV4OneShotRelayPort = Pick<FetchHostedV4OneShotRelay, "open">;
const hash = (bytes: string | Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const responsesUrl = "https://chatgpt.com/backend-api/codex/responses";

/** One provider attempt. Approval and store are server-owned; there is no
 * fallback account, retry loop, global cap switch, or restored-send path.
 * Buffers at most the existing response-byte budget before exposing success.
 * Provider success still requires the normal attestation/finalization chain. */
export class FetchHostedV4OneShotRelay {
  constructor(
    private readonly dependencies: {
      approval: HostedV4OneShotApproval | null;
      turns: Pick<
        HostedV4RelayTurnPort,
        "reservePreparedRequest" | "markTerminalUnknown"
      > &
        HostedV4RelayDispatchPort;
      runtime: Pick<
        HostedCodexSessionRuntime,
        "readFreshSessionWithoutRefresh"
      >;
      fetch?: typeof fetch;
      now?: () => Date;
      heartbeatIntervalMs?: number;
    },
  ) {
    const interval = dependencies.heartbeatIntervalMs ?? 2_000;
    if (!Number.isSafeInteger(interval) || interval < 5 || interval > 5_000)
      throw new Error("hosted_v4_heartbeat_interval_invalid");
  }

  async open(input: {
    authorization: AuthorizedHostedV4OneShot;
    body: Uint8Array;
    idempotencyKey: string;
    abortSignal: AbortSignal;
  }): Promise<{
    statusCode: 200;
    body: Buffer;
    contentType: "text/event-stream";
  }> {
    const { contract, accountId, grantId } = input.authorization;
    const now = this.dependencies.now ?? (() => new Date());
    assertHostedV4OneShotApproval({
      contract,
      approval: this.dependencies.approval,
      accountId,
      idempotencyKey: input.idempotencyKey,
      requestHash: hash(input.body),
      now: now(),
    });
    if (
      input.authorization.authorityKind !== "v4_relay_turn" ||
      grantId !== `v4-grant-${contract.logicalTurnKey}` ||
      input.body.byteLength < 1 ||
      input.body.byteLength > contract.maxRequestBytes
    )
      throw new Error("hosted_v4_request_invalid");
    const decoded: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(input.body),
    );
    if (!decoded || typeof decoded !== "object" || Array.isArray(decoded))
      throw new Error("hosted_v4_request_invalid");
    const request = decoded as Record<string, unknown>;
    if (
      request.model !== contract.scope.model ||
      request.stream !== true ||
      !Number.isSafeInteger(request.max_output_tokens) ||
      (request.max_output_tokens as number) < 1 ||
      (request.max_output_tokens as number) > contract.maxOutputTokens
    )
      throw new Error("hosted_v4_request_policy_invalid");
    input.abortSignal.throwIfAborted();
    const session =
      await this.dependencies.runtime.readFreshSessionWithoutRefresh({
        accountId,
        validUntil: contract.expiresAt,
        abortSignal: input.abortSignal,
      });
    if (
      !Number.isSafeInteger(session.credentialGeneration) ||
      session.credentialGeneration < 1
    )
      throw new Error("hosted_v4_credential_generation_invalid");
    const ownerIdHash = hash(randomUUID());
    const prepared = await this.dependencies.turns.reservePreparedRequest({
      contract,
      grantId,
      idempotencyKey: input.idempotencyKey,
      ordinal: 1,
      body: input.body,
      accountId,
      credentialGeneration: BigInt(session.credentialGeneration),
      ownerIdHash,
    });
    // This branch is deliberately outside the unknown-terminalization catch:
    // a duplicate reader must not cancel the rightful owner's current send.
    if (prepared.status !== "prepared")
      throw new Error("hosted_v4_recovery_required_no_resend");
    const lease: HostedV4DispatchLease = {
      contract,
      prepared,
      accountId,
      credentialGeneration: BigInt(session.credentialGeneration),
      ownerIdHash,
      fenceEpoch: 1n,
      idempotencyKey: input.idempotencyKey,
    };
    const sanitized: Record<string, unknown> = { ...request, store: false };
    delete sanitized.max_output_tokens;
    const providerBody = Buffer.from(JSON.stringify(sanitized));
    const heartbeatAbort = new AbortController();
    const remainingMs =
      Math.min(
        contract.expiresAt.getTime(),
        Date.parse(this.dependencies.approval!.expiresAt),
      ) - now().getTime();
    const signal = AbortSignal.any([
      input.abortSignal,
      heartbeatAbort.signal,
      AbortSignal.timeout(Math.max(1, remainingMs)),
    ]);
    let timer: ReturnType<typeof setInterval> | undefined;
    let pendingHeartbeat: Promise<void> | undefined;
    let heartbeatFailed = false;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const chunks: Buffer[] = [];
    try {
      if (remainingMs <= 0) throw new Error("hosted_v4_scope_expired");
      // Even an ambiguous transaction acknowledgement is not retried. The
      // durable effect must already be dispatching before fetch is reachable.
      await this.dependencies.turns.beginDispatch(lease);
      timer = setInterval(() => {
        if (pendingHeartbeat || heartbeatFailed) return;
        pendingHeartbeat = this.dependencies.turns
          .heartbeatDispatch(lease)
          .catch(() => {
            heartbeatFailed = true;
            heartbeatAbort.abort();
          })
          .finally(() => {
            pendingHeartbeat = undefined;
          });
      }, this.dependencies.heartbeatIntervalMs ?? 2_000);
      timer.unref();
      signal.throwIfAborted();
      const upstream = await (this.dependencies.fetch ?? fetch)(responsesUrl, {
        method: "POST",
        redirect: "error",
        signal,
        headers: {
          authorization: `Bearer ${session.accessToken}`,
          "chatgpt-account-id": session.chatgptAccountId,
          "content-type": "application/json",
          accept: "text/event-stream",
        },
        body: providerBody,
      });
      signal.throwIfAborted();
      if (
        !upstream.ok ||
        !upstream.body ||
        !upstream.headers
          .get("content-type")
          ?.toLowerCase()
          .startsWith("text/event-stream")
      ) {
        await upstream.body?.cancel();
        throw new Error("hosted_v4_upstream_outcome_uncertain");
      }
      await this.dependencies.turns.markDispatchResponseStarted(lease);
      reader = upstream.body.getReader();
      let bytes = 0;
      while (true) {
        signal.throwIfAborted();
        const chunk = await reader.read();
        signal.throwIfAborted();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > contract.maxResponseBytes)
          throw new Error("hosted_v4_response_too_large");
        chunks.push(Buffer.from(chunk.value));
      }
      const body = Buffer.concat(chunks);
      try {
        const terminalEvidenceHash = verifiedCompletedResponseHash(body);
        clearInterval(timer);
        timer = undefined;
        await pendingHeartbeat;
        signal.throwIfAborted();
        // Completion rechecks live authority and fencing inside the DB CAS.
        await this.dependencies.turns.completeDispatchResponse({
          ...lease,
          responseBytes: body.byteLength,
          responseHash: hash(body),
          terminalEvidenceHash,
        });
        return { statusCode: 200, body, contentType: "text/event-stream" };
      } catch (error) {
        body.fill(0);
        throw error;
      }
    } catch {
      heartbeatAbort.abort();
      await reader?.cancel().catch(() => undefined);
      // Never turn a failed recovery write into permission to replay. The
      // durable dispatch marker/sweeper still blocks another attempt.
      await this.dependencies.turns
        .markTerminalUnknown(contract.logicalTurnKey, now())
        .catch(() => undefined);
      throw new Error("hosted_v4_terminal_unknown_no_retry");
    } finally {
      if (timer) clearInterval(timer);
      await pendingHeartbeat;
      reader?.releaseLock();
      providerBody.fill(0);
      for (const chunk of chunks) chunk.fill(0);
    }
  }
}

/** Bounded, fully framed SSE. Neither EOF nor [DONE] establishes success.
 * Failure is sticky, one response identity spans every event, and no payload
 * may follow completion except one optional, unnamed [DONE] frame. */
function verifiedCompletedResponseHash(body: Buffer): string {
  const text = new TextDecoder("utf-8", { fatal: true })
    .decode(body)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  if (!text.endsWith("\n\n"))
    throw new Error("hosted_v4_response_not_completed");
  let completed: string | undefined;
  let responseId: string | undefined;
  let done = false;
  const invalid = () => new Error("hosted_v4_response_not_completed");
  const observeId = (id: unknown) => {
    if (
      typeof id !== "string" ||
      !id.trim() ||
      id.length > 512 ||
      (responseId !== undefined && responseId !== id)
    )
      throw invalid();
    responseId = id;
  };
  for (const frame of text.split("\n\n")) {
    const values: string[] = [];
    let eventName: string | undefined;
    let payloadField = false;
    let otherField = false;
    for (const line of frame.split("\n")) {
      if (!line || line.startsWith(":")) continue;
      payloadField = true;
      const colon = line.indexOf(":");
      const field = colon < 0 ? line : line.slice(0, colon);
      let value = colon < 0 ? "" : line.slice(colon + 1);
      if (value.startsWith(" ")) value = value.slice(1);
      if (field === "data") values.push(value);
      else if (field !== "event") otherField = true;
      if (field === "event") {
        if (eventName !== undefined || !value) throw invalid();
        eventName = value;
      }
    }
    if (!payloadField) continue; // Fully framed comments/keepalives only.
    const data = values.join("\n");
    if (data === "[DONE]") {
      if (!completed || done || eventName !== undefined || otherField)
        throw invalid();
      done = true;
      continue;
    }
    if (
      completed ||
      done ||
      eventName === "error" ||
      eventName === "response.failed" ||
      eventName === "response.incomplete"
    )
      throw invalid();
    if (!values.length) {
      if (eventName !== undefined) throw invalid();
      continue;
    }
    const parsed: unknown = JSON.parse(data);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw invalid();
    const event = parsed as Record<string, unknown>;
    if (
      typeof event.type !== "string" ||
      !event.type ||
      (eventName !== undefined && eventName !== event.type) ||
      event.type === "response.failed" ||
      event.type === "response.incomplete" ||
      event.type === "error" ||
      (event.error !== undefined && event.error !== null) ||
      (event.incomplete_details !== undefined &&
        event.incomplete_details !== null)
    )
      throw invalid();
    if (event.response_id !== undefined) observeId(event.response_id);
    let response: Record<string, unknown> | undefined;
    if (event.response !== undefined) {
      if (
        !event.response ||
        typeof event.response !== "object" ||
        Array.isArray(event.response)
      )
        throw invalid();
      response = event.response as Record<string, unknown>;
      observeId(response.id);
      if (
        (response.error !== undefined && response.error !== null) ||
        (response.incomplete_details !== undefined &&
          response.incomplete_details !== null) ||
        response.status === "failed" ||
        response.status === "incomplete" ||
        response.status === "cancelled"
      )
        throw invalid();
    }
    if (event.type === "response.completed") {
      if (!response || response.status !== "completed") throw invalid();
      completed = data;
    }
  }
  if (!completed) throw invalid();
  return hash(completed);
}
