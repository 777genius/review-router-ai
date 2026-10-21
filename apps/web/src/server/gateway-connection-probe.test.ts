import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { afterEach, expect, it } from "vitest";
import { createConsumerControlClient } from "@agent-teams/account-gateway/http";
import { ProviderAccountError } from "@reviewrouter/features-provider-accounts";
import { createGatewayConnectionProbe } from "./gateway-connection-probe";
import type { ConnectionProbeEvent } from "../features/account-gateway/connection-probe";

const stops: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(stops.splice(0).map((stop) => stop()));
});
async function fixture(
  mode:
    | "ok"
    | "failed"
    | "empty"
    | "truncated"
    | "mismatch"
    | "timeout"
    | "cleanup" = "ok",
) {
  const calls: { path: string; body: Record<string, unknown> }[] = [];
  const bearer = "synthetic-test-execution-bearer";
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const data = JSON.parse(body || "{}");
    calls.push({ path: req.url!, body: data });
    res.setHeader("content-type", "application/json");
    if (req.url === "/internal/v1/run-access") {
      const admission = {
        invocationRef: data.invocationRef,
        attemptRef: data.attemptRef,
        accountRef: data.accountRefs[0],
        authorizationEpoch: 7,
        subjectRef: data.subjectRef,
        policyRevision: data.policyRevision,
        bindingRevision: data.bindingRevision,
        profileId: data.profileId,
        limits: data.limits,
        expiresAt: data.deadline,
      };
      res.end(
        JSON.stringify({
          bearer,
          admission: {
            ...admission,
            ...(mode === "mismatch" ? { subjectRef: "foreign-subject" } : {}),
          },
          operation: {
            operationRef: data.operationId,
            state: "applied",
            result: {
              kind: "execution",
              executionRef: "test-execution",
              accountRef: admission.accountRef,
              authorizationEpoch: 7,
              deadline: data.deadline,
              state: "active",
            },
          },
        }),
      );
    } else if (req.url?.endsWith("/requests")) {
      expect(req.headers.authorization).toBe(`Bearer ${bearer}`);
      expect(data.model).toBe("test-model");
      expect(data.input).toEqual([
        {
          role: "user",
          content: [
            { type: "input_text", text: "Reply with the single word OK." },
          ],
        },
      ]);
      expect(data.service_tier).toBe("default");
      expect(data.store).toBe(false);
      expect(data.stream).toBe(true);
      const admitted = JSON.parse(String(req.headers["x-gateway-admission"]));
      expect(admitted.limits.requests).toBe(1);
      expect(admitted.accountRef).toBe("shared-test-account");
      res.setHeader("content-type", "text/event-stream");
      res.setHeader(
        "x-gateway-request-ref",
        String(req.headers["x-gateway-request-id"]),
      );
      res.flushHeaders();
      if (mode === "timeout") return;
      if (mode !== "empty")
        res.write(
          'data: {"type":"response.output_text.delta","delta":"OK"}\n\n',
        );
      if (mode === "failed")
        res.end(
          'data: {"type":"response.failed","response":{"status":"failed"}}\n\n',
        );
      else if (mode === "truncated") res.end();
      else
        res.end(
          'data: {"type":"response.completed","response":{"status":"completed","output":[]}}\n\n',
        );
    } else if (req.url?.endsWith("/close"))
      res.end(
        JSON.stringify({
          operationRef: data.operationId,
          state: mode === "cleanup" ? "pending" : "applied",
        }),
      );
    else {
      res.statusCode = 404;
      res.end("{}");
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  stops.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const address = server.address();
  if (typeof address !== "object" || !address) throw new Error("address");
  const origin = `http://127.0.0.1:${address.port}`;
  const tuple = {
    workspaceId: "borrower-workspace",
    bindingId: "borrower-binding",
    bindingRevision: 2,
    policySubject: "borrower-binding",
    policyRevision: 3,
    connectionId: "donor-connection",
    gatewayAccountRef: "shared-test-account",
    profileRef: "responses-profile",
    expectedAuthorizationEpoch: 7,
    authorizationEpoch: 7,
  };
  return {
    calls,
    tuple,
    origin,
    control: createConsumerControlClient({
      role: "consumer-control",
      origin,
      token: "synthetic-consumer-control-token",
    }),
  };
}
const request = () => ({
  bindingId: "borrower-binding",
  model: "test-model",
  nonce: randomUUID(),
});

it("sends one real HTTP inference through the SDK, reports actual stages, validates text and closes", async () => {
  const f = await fixture();
  const events: ConnectionProbeEvent[] = [];
  await createGatewayConnectionProbe({
    resolve: async () => f.tuple,
    admit: async () => {},
    control: f.control,
    executionOrigin: f.origin,
  })(request(), (e) => events.push(e), new AbortController().signal);
  expect(
    events.filter((e) => e.type === "progress").map((e) => e.stage),
  ).toEqual([
    "authorizing",
    "connecting",
    "requesting",
    "receiving",
    "validating",
    "closing",
  ]);
  expect(events.at(-1)).toMatchObject({
    type: "result",
    ok: true,
    model: "test-model",
  });
  expect(f.calls.map((c) => c.path)).toEqual([
    "/internal/v1/run-access",
    "/v1/executions/test-execution/requests",
    "/v1/executions/test-execution/close",
  ]);
  expect(JSON.stringify(events)).not.toContain("bearer");
  expect(JSON.stringify(events)).not.toContain("shared-test-account");
});
it("uses the Codex native Responses shape without unsupported output-token fields", async () => {
  const f = await fixture();
  const events: ConnectionProbeEvent[] = [];
  await createGatewayConnectionProbe({
    resolve: async () => ({
      ...f.tuple,
      profileRef: "openai-codex-oauth-responses-v1",
    }),
    admit: async () => {},
    control: f.control,
    executionOrigin: f.origin,
  })(request(), (e) => events.push(e), new AbortController().signal);
  expect(events.at(-1)).toMatchObject({ ok: true });
  const body = f.calls.find((c) => c.path.endsWith("/requests"))!.body;
  expect(body).not.toHaveProperty("max_output_tokens");
  expect(body.instructions).toBeTypeOf("string");
});
it.each(["failed", "empty", "truncated", "mismatch", "cleanup"] as const)(
  "rejects %s without retrying inference and still closes",
  async (mode) => {
    const f = await fixture(mode);
    const events: ConnectionProbeEvent[] = [];
    await createGatewayConnectionProbe({
      resolve: async () => f.tuple,
      admit: async () => {},
      control: f.control,
      executionOrigin: f.origin,
    })(request(), (e) => events.push(e), new AbortController().signal);
    expect(events.at(-1)).toMatchObject({
      type: "result",
      ok: false,
      code:
        mode === "mismatch"
          ? "denied"
          : mode === "cleanup"
            ? "cleanup_pending"
            : "invalid_response",
    });
    expect(f.calls.filter((c) => c.path.endsWith("/requests"))).toHaveLength(
      mode === "mismatch" ? 0 : 1,
    );
    expect(f.calls.at(-1)?.path).toContain("/close");
  },
);
it("rejects unavailable shared authority before preparation", async () => {
  const f = await fixture();
  const events: ConnectionProbeEvent[] = [];
  await createGatewayConnectionProbe({
    resolve: async () => {
      throw new ProviderAccountError("binding_unavailable");
    },
    admit: async () => {},
    control: f.control,
    executionOrigin: f.origin,
  })(request(), (e) => events.push(e), new AbortController().signal);
  expect(events.at(-1)).toEqual({ type: "result", ok: false, code: "denied" });
  expect(f.calls).toHaveLength(0);
});
it("closes without inference when binding revisions change during preparation", async () => {
  const f = await fixture();
  let checks = 0;
  const events: ConnectionProbeEvent[] = [];
  await createGatewayConnectionProbe({
    resolve: async () => ({
      ...f.tuple,
      policyRevision: ++checks >= 3 ? 4 : 3,
    }),
    admit: async () => {},
    control: f.control,
    executionOrigin: f.origin,
  })(request(), (e) => events.push(e), new AbortController().signal);
  expect(events.at(-1)).toMatchObject({ ok: false, code: "denied" });
  expect(f.calls.map((c) => c.path)).toEqual([
    "/internal/v1/run-access",
    "/v1/executions/test-execution/close",
  ]);
});
it("times out an open provider stream and closes using a fresh cleanup signal", async () => {
  const f = await fixture("timeout");
  const events: ConnectionProbeEvent[] = [];
  await createGatewayConnectionProbe({
    resolve: async () => f.tuple,
    admit: async () => {},
    control: f.control,
    executionOrigin: f.origin,
    timeoutMs: 100,
  })(request(), (e) => events.push(e), new AbortController().signal);
  expect(events.at(-1)).toMatchObject({ ok: false, code: "timeout" });
  expect(f.calls.at(-1)?.path).toContain("/close");
});
