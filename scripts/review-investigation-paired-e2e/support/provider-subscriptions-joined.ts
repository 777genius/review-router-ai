/** Explicit preload for native-provider-joined.ts. Real installed Action + pinned
 * Codex CLI -> private loopback -> public SDK -> Gateway -> native fixture.
 * This module never accepts or forwards a provider credential to the CLI. */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import type * as GatewayHTTP from "@agent-teams/account-gateway/http";
import { protectedResponsesToolPolicyConfigLines } from "../../../packages/features/codex-oauth-rotating/src/action/github-action";

type JoinedInput = Readonly<{
  origin: string;
  token: string;
  accountRef: string;
  profileId: string;
  model: string;
  limits: Readonly<{
    requests: number;
    concurrency: number;
    requestBytes: number;
    outputBytes: number;
    tokens: number;
  }>;
}>;
type InstalledCodex = {
  CodexProvider: new (
    model: string,
    options: {
      agenticContext: boolean;
      eventAudit: boolean;
    },
  ) => {
    review(
      prompt: string,
      timeoutMs: number,
    ): Promise<{
      findings: readonly unknown[];
      revalidations?: readonly unknown[];
      content: string;
    }>;
  };
};
type RelayAdapter = {
  createReviewRunGatewayTerminalGate(maximumBytes: number): {
    push(bytes: Uint8Array): readonly Uint8Array[];
    finish(): readonly Uint8Array[];
  };
  prepareReviewRunGatewayResponses(
    raw: Uint8Array,
    model: string,
    tokens: number,
    maximum: number,
    qualifiedTokens: number,
  ): Uint8Array;
};
const execFileAsync = promisify(execFile);
export const joinedActionRef = "0454fc0a3af15f94522c7c31cce59c0c62af6567";
const actionArchiveDigest =
  "f76f0ab503b7b3d2ea000639e8ca47e5377a3b66d5140c669c39e8a9df00db7c";
const codexSourceDigest =
  "22967b9f1e4bb463926df901af002e8d97bc272bd6396f28f67cd4463626bcef";
const codexBinaryDigest =
  "524396258c974948334eabe6f2c6b1d8e1979dfd048d67d535ad9e4550fa5b26";
const finalReview = { findings: [], revalidations: [] };
let running = false;
export const joinedProviderReceipts: Readonly<Record<string, unknown>>[] = [];

function requiredPath(name: string): string {
  const value = process.env[name];
  assert.ok(value && path.isAbsolute(value), name + " must be absolute");
  return value;
}
function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
function loopback(origin: string): void {
  const value = new URL(origin);
  assert.equal(value.protocol, "http:");
  assert.equal(value.hostname, "127.0.0.1");
  assert.ok(value.port);
  assert.equal(value.pathname, "/");
  assert.equal(value.username + value.password + value.search + value.hash, "");
}
async function bodyBytes(
  request: IncomingMessage,
  maximum: number,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const raw of request) {
    const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
    size += chunk.byteLength;
    assert.ok(size <= maximum, "joined request byte bound");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}

/** Invoked once per provider by the real Gateway harness after protected enrollment. */
export async function acceptProvider(input: JoinedInput): Promise<void> {
  assert.equal(running, false, "joined caller must run sequentially");
  running = true;
  let phase = "guard";
  let failure: Error | undefined;
  let root: string | undefined;
  let execution: GatewayHTTP.ExecutionClient | undefined;
  let executionRef: string | undefined;
  let closeReason: "completed" | "failed" = "failed";
  let relayFailure = false;
  let relayPhase = "none";
  let entries = 0;
  let completions = 0;
  let toolOutput = false;
  let declaredCustomTools = 0;
  let declaredFunctionTools = 0;
  let returnedCustomTools = 0;
  let returnedFunctionTools = 0;
  const active = new Set<() => Promise<void>>();
  const inFlight = new Set<Promise<void>>();
  const savedEnv = { ...process.env };
  const savedCwd = process.cwd();
  const relay = createServer();
  try {
    loopback(input.origin);
    assert.ok(input.model && input.profileId && input.accountRef);
    const archive = requiredPath("RR_PROVIDER_JOINED_ACTION_ARCHIVE");
    const binary = requiredPath("RR_PROVIDER_JOINED_CODEX_BINARY");
    const sdkPath = requiredPath("RR_PROVIDER_JOINED_SDK_HTTP");
    const relayAdapterPath = requiredPath("RR_PROVIDER_JOINED_RELAY_ADAPTER");
    phase = "source-provenance";
    assert.equal(digest(await readFile(archive)), actionArchiveDigest);
    root = await mkdtemp(
      path.join(
        requiredPath("RR_PROVIDER_JOINED_WORK_ROOT"),
        "reviewrouter-provider-joined-",
      ),
    );
    const source = path.join(root, "action-source");
    await mkdir(source, { mode: 0o700 });
    // Import every Action helper from the verified immutable archive, never
    // from a possibly dirty working tree or a mutable pre-extracted directory.
    await execFileAsync("tar", ["-xf", archive, "-C", source], {
      timeout: 5000,
    });
    const providerSource = path.join(source, "src/providers/codex.ts");
    assert.equal(digest(await readFile(providerSource)), codexSourceDigest);
    assert.equal(digest(await readFile(binary)), codexBinaryDigest);
    const oauthSource = await readFile(
      path.join(source, "src/codex-oauth/codex-cli.ts"),
      "utf8",
    );
    assert.equal(
      oauthSource.match(
        /CODEX_OAUTH_PINNED_CODEX_PACKAGE\s*=\s*['"]@openai\/codex@([0-9.]+)['"]/u,
      )?.[1],
      "0.133.0",
    );
    const version = await execFileAsync(binary, ["--version"], {
      timeout: 5000,
    });
    assert.match(version.stdout.trim(), /^codex-cli 0\.133\.0$/u);
    const sdk = (await import(
      pathToFileURL(sdkPath).href
    )) as typeof GatewayHTTP;
    process.env.LOG_LEVEL = "error";
    const installed = (await import(
      pathToFileURL(providerSource).href
    )) as InstalledCodex;
    const relayAdapter = (await import(
      pathToFileURL(relayAdapterPath).href
    )) as RelayAdapter;
    phase = "disposable-workspace";
    const checkout = path.join(root, "checkout");
    const home = path.join(root, "home");
    const codexHome = path.join(home, ".codex");
    await mkdir(checkout, { recursive: true });
    await mkdir(codexHome, { recursive: true, mode: 0o700 });
    await writeFile(
      path.join(checkout, "contract.ts"),
      "export const joinedFixture = true;\n",
    );
    await writeFile(
      path.join(checkout, "caller.ts"),
      "import { joinedFixture } from './contract';\n",
    );
    await execFileAsync("git", ["init", "-q", checkout], { timeout: 5000 });
    phase = "sdk-run-access";
    const consumer = sdk.createConsumerControlClient({
      role: "consumer-control",
      origin: input.origin,
      token: input.token,
      timeoutMs: 5000,
    });
    const access = await consumer.runAccess({
      operationId: randomUUID(),
      invocationRef: randomUUID(),
      attemptRef: randomUUID(),
      accountRefs: [input.accountRef],
      subjectRef: "joined-provider-policy",
      policyRevision: 1,
      bindingRevision: 1,
      profileId: input.profileId,
      limits: input.limits,
      deadline: new Date(Date.now() + 55_000).toISOString(),
    });
    assert.equal(access.operation.state, "applied");
    assert.equal(access.operation.result?.kind, "execution");
    if (access.operation.result?.kind !== "execution")
      throw new Error("joined_execution_missing");
    executionRef = access.operation.result.executionRef;
    execution = sdk.createExecutionClient({
      role: "execution",
      origin: input.origin,
      token: access.bearer,
      timeoutMs: 50_000,
    });
    const selectedExecution = execution;
    const selectedRef = executionRef;
    const relayKey = randomBytes(32).toString("base64url");
    relay.on("request", (request, response) => {
      const work = relayRequest(request, response);
      inFlight.add(work);
      void work.finally(() => inFlight.delete(work));
    });
    async function relayRequest(
      request: IncomingMessage,
      response: ServerResponse,
    ): Promise<void> {
      let cancel: (() => Promise<void>) | undefined;
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      let complete = false;
      const abort = new AbortController();
      const disconnected = () => {
        if (!complete) {
          abort.abort();
          void cancel?.();
        }
      };
      response.once("close", disconnected);
      try {
        relayPhase = "ingress";
        assert.equal(request.method, "POST");
        assert.equal(request.url, "/v1/responses");
        assert.equal(request.headers.authorization, "Bearer " + relayKey);
        assert.ok(++entries <= 2, "joined maximum two provider entries");
        const bytes = await bodyBytes(request, input.limits.requestBytes);
        const raw = JSON.parse(bytes.toString("utf8")) as Record<
          string,
          unknown
        >;
        process.stdout.write(
          JSON.stringify({
            phase: "actual-cli-request-shape",
            profileId: input.profileId,
            modelMatches: raw.model === input.model,
            streamTrue: raw.stream === true,
            reasoningPresent: "reasoning" in raw,
            reasoningNull: raw.reasoning === null,
            serviceTierPresent: "service_tier" in raw,
            textNull: raw.text === null,
            promptCacheKeyPresent: "prompt_cache_key" in raw,
            clientMetadataPresent: "client_metadata" in raw,
          }) + "\n",
        );
        relayPhase = "cli-model";
        assert.equal(raw.model, input.model);
        relayPhase = "cli-stream";
        assert.equal(raw.stream, true);
        relayPhase = "cli-reasoning";
        assert.ok(
          raw.reasoning === undefined || raw.reasoning === null,
          "unsupported reasoning must not inherit ambient xhigh",
        );
        relayPhase = "cli-fast";
        assert.ok(
          !("service_tier" in raw),
          "unsupported fast must not enter the provider request",
        );
        if (entries === 1) {
          relayPhase = "cli-tool-declarations";
          assert.ok(
            Array.isArray(raw.tools) && raw.tools.length > 0,
            "real CLI must advertise tools",
          );
          declaredCustomTools = (raw.tools as Record<string, unknown>[]).filter(
            (tool) => tool.type === "custom",
          ).length;
          declaredFunctionTools = (
            raw.tools as Record<string, unknown>[]
          ).filter((tool) => tool.type === "function").length;
        } else {
          relayPhase = "cli-tool-output";
          assert.ok(Array.isArray(raw.input));
          toolOutput = (raw.input as Record<string, unknown>[]).some((item) =>
            ["function_call_output", "custom_tool_call_output"].includes(
              String(item.type),
            ),
          );
          assert.equal(
            toolOutput,
            true,
            "real CLI tool output must return to provider",
          );
          returnedFunctionTools = (
            raw.input as Record<string, unknown>[]
          ).filter(
            (item) =>
              item.type === "function_call_output" &&
              typeof item.output === "string" &&
              item.output.length > 0,
          ).length;
          returnedCustomTools = (raw.input as Record<string, unknown>[]).filter(
            (item) =>
              item.type === "custom_tool_call_output" &&
              typeof item.output === "string" &&
              item.output.length > 0,
          ).length;
          assert.ok(returnedFunctionTools > 0, "real function output required");
          if (declaredCustomTools > 0)
            assert.ok(
              returnedCustomTools > 0,
              "declared custom tool output required",
            );
        }
        const requestId = randomUUID();
        relayPhase = "production-relay-adapter";
        const preparedBody = relayAdapter.prepareReviewRunGatewayResponses(
          bytes,
          input.model,
          100,
          input.limits.requestBytes,
          input.limits.tokens,
        );
        const forwarded = JSON.parse(
          new TextDecoder().decode(preparedBody),
        ) as Record<string, unknown>;
        assert.ok(!("reasoning" in forwarded));
        assert.equal(forwarded.service_tier, "default");
        relayPhase = "sdk-execution-request";
        const upstream = await selectedExecution.request(
          selectedRef,
          {
            requestId,
            admission: access.admission,
            body: Buffer.from(preparedBody),
          },
          { signal: abort.signal },
        );
        assert.equal(upstream.kind, "stream");
        if (upstream.kind !== "stream")
          throw new Error("joined_stream_missing");
        cancel = upstream.cancel;
        active.add(cancel);
        reader = upstream.body.getReader();
        response.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-store",
        });
        let wire = "";
        const decoder = new TextDecoder();
        relayPhase = "sdk-stream";
        const terminalGate = relayAdapter.createReviewRunGatewayTerminalGate(
          input.limits.outputBytes,
        );
        const write = async (bytes: Uint8Array) => {
          if (complete && response.destroyed) return;
          if (!response.write(bytes))
            await new Promise<void>((resolve, reject) => {
              const drained = () => {
                response.off("close", closed);
                resolve();
              };
              const closed = () => {
                response.off("drain", drained);
                if (complete) resolve();
                else reject(new Error("joined_disconnected"));
              };
              response.once("drain", drained);
              response.once("close", closed);
            });
        };
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          wire += decoder.decode(part.value, { stream: true });
          for (const bytes of terminalGate.push(part.value)) await write(bytes);
        }
        wire += decoder.decode();
        assert.match(wire, /response\.completed/u);
        completions++;
        complete = true;
        // The same production gate releases the unchanged terminal only after
        // the SDK has completed its native closure acknowledgement.
        for (const bytes of terminalGate.finish()) await write(bytes);
        response.end();
      } catch (error) {
        if (error instanceof sdk.GatewayError)
          process.stdout.write(
            JSON.stringify({
              phase: "actual-cli-sdk-error",
              profileId: input.profileId,
              code: error.code,
              effect: error.effect,
              diagnosticCode: error.diagnostic?.code,
              httpStatus: error.httpStatus,
            }) + "\n",
          );
        relayFailure = true;
        abort.abort();
        await cancel?.().catch(() => undefined);
        if (!response.headersSent)
          response.writeHead(502, { "content-type": "application/json" });
        response.end(
          '{"error":{"message":"controlled_joined_relay_failed","type":"server_error"}}',
        );
      } finally {
        response.off("close", disconnected);
        if (cancel) active.delete(cancel);
        if (reader) {
          if (!complete) await reader.cancel().catch(() => undefined);
          reader.releaseLock();
        }
      }
    }
    await new Promise<void>((resolve, reject) => {
      relay.once("error", reject);
      relay.listen(0, "127.0.0.1", resolve);
    });
    const address = relay.address();
    assert.ok(address && typeof address === "object");
    const relayOrigin = "http://127.0.0.1:" + address.port;
    await writeFile(
      path.join(codexHome, "config.toml"),
      [
        ...protectedResponsesToolPolicyConfigLines(),
        'model_provider = "reviewrouter_joined"',
        "[model_providers.reviewrouter_joined]",
        'name = "reviewrouter_joined"',
        'base_url = "' + relayOrigin + '/v1"',
        'env_key = "OPENAI_API_KEY"',
        'wire_api = "responses"',
        "request_max_retries = 0",
        "stream_max_retries = 0",
        "supports_websockets = false",
        "",
      ].join("\n"),
      { mode: 0o600 },
    );
    // CodexProvider reads this environment itself; the child receives only its
    // existing safe allowlist. Consumer/execution capabilities stay in this process.
    process.env.HOME = home;
    process.env.CODEX_HOME = codexHome;
    process.env.OPENAI_API_KEY = relayKey;
    process.env.REVIEWROUTER_CODEX_BINARY = binary;
    process.env.REVIEWROUTER_FORK_AGENTIC_SANDBOX = "true";
    process.env.CODEX_AGENTIC_AUDIT = "strict";
    delete process.env.CODEX_REASONING_EFFORT;
    process.chdir(checkout);
    phase = "installed-action-real-cli-review";
    const provider = new installed.CodexProvider(input.model, {
      agenticContext: true,
      eventAudit: true,
    });
    const result = await provider.review(
      "Review the disposable fixture.\nFiles changed: contract.ts\nDiff:\n+export const joinedFixture = true;\n",
      45_000,
    );
    phase = "tool-cycle-and-parser-proof";
    assert.equal(relayFailure, false);
    assert.equal(entries, 2);
    assert.equal(completions, 2);
    assert.equal(toolOutput, true);
    assert.deepEqual(JSON.parse(result.content), finalReview);
    assert.deepEqual(result.findings, []);
    assert.deepEqual(result.revalidations, []);
    closeReason = "completed";
  } catch {
    // Neither raw CLI/provider errors nor SDK diagnostics (which may carry
    // capability identity) are emitted by this acceptance boundary.
    const code = (
      "rr_provider_joined_failed_" +
      phase +
      "_" +
      relayPhase
    ).replace(/[^a-z_]/gu, "_");
    failure = Object.assign(new Error(code), { code });
  } finally {
    process.chdir(savedCwd);
    for (const key of Object.keys(process.env))
      if (!(key in savedEnv)) delete process.env[key];
    Object.assign(process.env, savedEnv);
    try {
      await Promise.allSettled([...active].map((cancel) => cancel()));
      relay.closeAllConnections();
      if (relay.listening)
        await new Promise<void>((resolve, reject) =>
          relay.close((error) => (error ? reject(error) : resolve())),
        );
      await Promise.allSettled(inFlight);
      if (execution && executionRef) {
        const operation = await execution.close(executionRef, {
          operationId: randomUUID(),
          reason: closeReason,
        });
        assert.equal(
          operation.state,
          "applied",
          "joined execution closure ACK required",
        );
        if (closeReason === "completed")
          joinedProviderReceipts.push(
            Object.freeze({
              profileId: input.profileId,
              model: input.model,
              actionRef: joinedActionRef,
              actionArchiveSHA256: actionArchiveDigest,
              codexBinarySHA256: codexBinaryDigest,
              codexVersion: "0.133.0",
              providerEntries: entries,
              streamCompletions: completions,
              declaredFunctionTools,
              declaredCustomTools,
              returnedFunctionTools,
              returnedCustomTools,
              reasoningOmitted: true,
              fastOmitted: true,
              executionClosureAcknowledged: true,
            }),
          );
      }
    } catch {
      failure ??= Object.assign(
        new Error("rr_provider_joined_failed_execution_cleanup"),
        { code: "rr_provider_joined_failed_execution_cleanup" },
      );
    } finally {
      if (root)
        await rm(root, { recursive: true, force: true }).catch(() => {
          failure ??= Object.assign(
            new Error("rr_provider_joined_failed_workspace_cleanup"),
            { code: "rr_provider_joined_failed_workspace_cleanup" },
          );
        });
      running = false;
    }
  }
  if (failure) throw failure;
}

const hook = Symbol.for("provider-joined-e2e.acceptProvider");
assert.equal(
  Reflect.has(globalThis, hook),
  false,
  "joined acceptance preload must be unique",
);
Reflect.set(globalThis, hook, acceptProvider);
Reflect.set(
  globalThis,
  Symbol.for("provider-joined-e2e.rrReceipts"),
  joinedProviderReceipts,
);
