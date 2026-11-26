import { Readable } from "node:stream";
import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { registerPublicationDiagnostics } from "./publication-diagnostics.js";

const renewPath = "/api/action/v2/review-runs/renew";
const statusPath = "/api/action/v2/review-publication/status";
const secret = "private-token-request-id-header-body-error";
const apps: ReturnType<typeof Fastify>[] = [];

function fixture() {
  const app = Fastify();
  apps.push(app);
  return { app, diagnostics: registerPublicationDiagnostics(app) };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("paired publication API diagnostics", () => {
  it("observes only the five POST routes and safe response fields", async () => {
    const { app, diagnostics } = fixture();
    const responses = [
      [renewPath, { status: "renewed" }],
      ["/api/action/v2/review-executions/restore", { status: "missing" }],
      ["/api/action/v2/review-executions/finalize", { status: "applied" }],
      [
        "/api/action/v2/review-publication/request",
        { status: "accepted", pollAfterMs: 1000 },
      ],
      [statusPath, { status: "terminal", terminalOutcome: "succeeded" }],
    ] as const;
    for (const [path, result] of responses) {
      app.post(path, async () => ({
        requestId: secret,
        authorizationToken: secret,
        result: { ...result, payload: secret },
      }));
    }
    app.get(statusPath, async () => ({ result: { status: "pending" } }));
    app.post("/unrelated", async () => ({ result: { status: "pending" } }));
    await app.inject({ method: "POST", url: renewPath });
    const trace = diagnostics.beginRun();
    for (const [path, result] of responses) {
      const response = await app.inject({
        method: "POST",
        url: `${path}?private=${secret}`,
        headers: { authorization: secret, "x-request-id": secret },
        payload: { token: secret },
      });
      expect(response.json()).toEqual({
        requestId: secret,
        authorizationToken: secret,
        result: { ...result, payload: secret },
      });
    }
    await app.inject({ method: "GET", url: statusPath });
    await app.inject({ method: "POST", url: "/unrelated" });
    const snapshot = trace.snapshot();
    expect(snapshot.completed).toEqual(
      responses.map(([path, { status, ...fields }], index) => ({
        requestNumber: index + 1,
        path,
        statusCode: 200,
        startedAfterMs: expect.any(Number),
        durationMs: expect.any(Number),
        resultStatus: status,
        ...fields,
      })),
    );
    expect(snapshot.inFlight).toEqual([]);
    expect(JSON.stringify(snapshot)).not.toContain(secret);
  });

  it("reads nested V2 failures and drops unknown or mistyped values", async () => {
    const { app, diagnostics } = fixture();
    const failure = {
      requestId: secret,
      code: secret,
      error: {
        errorCode: "capacity_limited",
        retryClass: "safe_retry",
        details: { issues: [secret] },
      },
    };
    app.post(renewPath, async (_request, reply) =>
      reply.code(429).send(failure),
    );
    app.post(statusPath, async (request) => request.body);
    const trace = diagnostics.beginRun();
    expect(
      (await app.inject({ method: "POST", url: renewPath })).json(),
    ).toEqual(failure);
    for (const pollAfterMs of [secret, -1, 1.5, null]) {
      await app.inject({
        method: "POST",
        url: statusPath,
        payload: {
          result: { status: secret, terminalOutcome: secret, pollAfterMs },
          error: { errorCode: secret },
        },
      });
    }
    const snapshot = trace.snapshot();
    expect(snapshot.completed[0]).toEqual({
      requestNumber: 1,
      path: renewPath,
      statusCode: 429,
      startedAfterMs: expect.any(Number),
      durationMs: expect.any(Number),
      errorCode: "capacity_limited",
    });
    expect(snapshot.completed.slice(1)).toEqual(
      [2, 3, 4, 5].map((requestNumber) => ({
        requestNumber,
        path: statusPath,
        statusCode: 200,
        startedAfterMs: expect.any(Number),
        durationMs: expect.any(Number),
      })),
    );
    expect(JSON.stringify(snapshot)).not.toContain(secret);
  });

  it("bounds completed and in-flight history and reports omissions", async () => {
    const { app, diagnostics } = fixture();
    const entered = deferred();
    const release = deferred();
    let started = 0;
    app.post(renewPath, async () => ({ result: { status: "renewed" } }));
    app.post(statusPath, async () => {
      if (++started === 33) entered.resolve();
      await release.promise;
      return { result: { status: "pending" } };
    });
    const trace = diagnostics.beginRun();
    for (let index = 0; index < 40; index++) {
      await app.inject({ method: "POST", url: renewPath });
    }
    expect(
      trace.snapshot().completed.map((entry) => entry.requestNumber),
    ).toEqual(Array.from({ length: 32 }, (_, index) => index + 9));
    expect(trace.snapshot().droppedCompleted).toBe(8);
    const pending = Promise.all(
      Array.from({ length: 33 }, () =>
        app.inject({ method: "POST", url: statusPath }),
      ),
    );
    try {
      await entered.promise;
      const snapshot = trace.snapshot();
      expect(snapshot.inFlight).toHaveLength(32);
      expect(snapshot.inFlight[0]?.requestNumber).toBe(42);
      expect(snapshot.droppedInFlight).toBe(1);
    } finally {
      release.resolve();
      await pending;
    }
    expect(trace.snapshot().inFlight).toEqual([]);
    expect(trace.snapshot().completed).toHaveLength(32);
    expect(trace.snapshot().droppedCompleted).toBe(41);
  });

  it("keeps a pending request and its completion in the originating run", async () => {
    const { app, diagnostics } = fixture();
    const entered = deferred();
    const release = deferred();
    app.post(statusPath, async () => {
      entered.resolve();
      await release.promise;
      return { result: { status: "pending", pollAfterMs: 1000 } };
    });
    app.post(renewPath, async () => ({ result: { status: "renewed" } }));
    const first = diagnostics.beginRun();
    const pending = app.inject({ method: "POST", url: statusPath }).then();
    try {
      await entered.promise;
      const snapshot = first.snapshot();
      expect(snapshot.completed).toEqual([]);
      expect(snapshot.inFlight).toEqual([
        { requestNumber: 1, path: statusPath, ageMs: expect.any(Number) },
      ]);
      expect(snapshot.inFlight[0]?.ageMs).toBeGreaterThanOrEqual(0);
      const second = diagnostics.beginRun();
      await app.inject({ method: "POST", url: renewPath });
      release.resolve();
      await pending;
      expect(first.snapshot().inFlight).toEqual([]);
      expect(first.snapshot().completed.map((entry) => entry.path)).toEqual([
        statusPath,
      ]);
      expect(second.snapshot().completed.map((entry) => entry.path)).toEqual([
        renewPath,
      ]);
      expect(second.snapshot().inFlight).toEqual([]);
      expect(snapshot.completed).toEqual([]);
      expect(snapshot.inFlight).toHaveLength(1);
    } finally {
      release.resolve();
      await pending;
    }
  });

  it("leaves streamed, oversized and malformed responses unchanged", async () => {
    const { app, diagnostics } = fixture();
    const json = JSON.stringify({ result: { status: "pending" }, secret });
    const oversized = JSON.stringify({
      result: { status: "pending" },
      padding: secret.repeat(2048),
    });
    const cases = [
      { body: Readable.from([json]), expected: json },
      { body: oversized, expected: oversized },
      { body: `${secret}{`, expected: `${secret}{` },
      { body: Buffer.from(json), expected: json },
    ];
    let next = 0;
    app.post(statusPath, async (_request, reply) =>
      reply.type("application/json").send(cases[next++]!.body),
    );
    const trace = diagnostics.beginRun();
    for (const { expected } of cases) {
      expect((await app.inject({ method: "POST", url: statusPath })).body).toBe(
        expected,
      );
    }
    const snapshot = trace.snapshot();
    expect(snapshot.completed.map((entry) => entry.resultStatus)).toEqual([
      undefined,
      undefined,
      undefined,
      "pending",
    ]);
    expect(JSON.stringify(snapshot)).not.toContain(secret);
  });
});
