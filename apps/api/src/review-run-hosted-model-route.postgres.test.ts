import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  confirmOriginalHostedReviewBinding,
  confirmOriginalHostedReviewBindingForCompletion,
} from "./review-run-hosted-binding";
import { createHostedModelDatabaseFixture } from "./test-support/review-hosted-model-database-fixture";

const databaseUrl = process.env.REVIEW_ROUTER_HOSTED_MODEL_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const hash = (value: Buffer) =>
  createHash("sha256").update(value).digest("hex");
type Fixture = Awaited<ReturnType<typeof createHostedModelDatabaseFixture>>;

describeDatabase(
  "Hosted native + V2 dispatch ledgers with real PostgreSQL and HTTP",
  () => {
    const fixtures: Fixture[] = [];
    afterEach(async () => {
      for (const fixture of fixtures.splice(0)) await fixture.close();
    });
    async function fixture(
      ...args: Parameters<typeof createHostedModelDatabaseFixture> extends [
        string,
        ...infer A,
      ]
        ? A
        : never
    ) {
      const result = await createHostedModelDatabaseFixture(
        databaseUrl!,
        ...args,
      );
      fixtures.push(result);
      return result;
    }
    async function claim(f: Fixture) {
      const result = await f.claim();
      expect(result.status, await result.clone().text()).toBe(200);
      const value = (await result.json()) as {
        status: string;
        receiptToken: string;
      };
      expect(value.status).toBe("claimed");
      expect(value.receiptToken).toMatch(/^[a-f0-9]{64}$/u);
      return value.receiptToken;
    }
    async function dispatch(f: Fixture) {
      return f.prisma.reviewRunCompanionDispatchV1.findUniqueOrThrow({
        where: {
          authorizationId_dispatchId: {
            authorizationId: f.authorization.authorizationId,
            dispatchId: f.context().dispatchId,
          },
        },
      });
    }
    async function native(f: Fixture) {
      return f.prisma.hostedCodexInvocationGrant.findUniqueOrThrow({
        where: { id: f.hosted.grantId },
        include: { relayRequests: { include: { upstreamAttempts: true } } },
      });
    }
    function completed(f: Fixture, raw: Buffer) {
      const frame = raw
        .toString("utf8")
        .split("\n")
        .filter((line) => line.startsWith("data: ") && !line.includes("[DONE]"))
        .map((line) => JSON.parse(line.slice(6)))
        .find((event) => event.type === "response.completed");
      if (!frame?.response?.usage)
        throw new Error("fixture_terminal_usage_required");
      return {
        state: "completed",
        receipt: {
          version: 2,
          routeIdentityHash: f.budget.routeIdentityHash,
          providerRequestEnvelopeHash: f.context().providerRequestEnvelopeHash,
          actualModel: frame.response.model,
          responseHash: hash(raw),
          responseBytes: raw.byteLength,
          fullyConsumed: true,
          terminal: "completed",
          usage: {
            inputTokens: frame.response.usage.input_tokens,
            outputTokens: frame.response.usage.output_tokens,
            totalTokens: frame.response.usage.total_tokens,
          },
        },
      };
    }

    it("finishes the original exhausted grant and settles its one paid request after run bearer expiry", async () => {
      const f = await fixture();
      const receiptToken = await claim(f);
      const response = await f.request();
      const raw = Buffer.from(await response.arrayBuffer());
      expect(
        response.status,
        `${raw.toString("utf8")} ${f.diagnostics.join("; ")}`,
      ).toBe(200);
      expect(f.seen).toEqual([
        { account: f.hosted.activeAccountId, body: JSON.parse(f.body) },
      ]);
      expect(f.sessions).toEqual([f.hosted.activeAccountId]);
      const grant = await native(f);
      expect(grant).toMatchObject({
        status: "exhausted",
        requestCount: 1,
        inFlight: 0,
        failoverCount: 0,
        activeAccountId: f.hosted.activeAccountId,
      });
      expect(grant.relayRequests).toHaveLength(1);
      expect(grant.relayRequests[0]).toMatchObject({
        status: "succeeded",
        requestHash: f.context().providerRequestEnvelopeHash,
        responseHash: hash(raw),
        responseBytes: raw.byteLength,
      });
      expect(grant.relayRequests[0]!.upstreamAttempts).toHaveLength(1);
      expect(grant.relayRequests[0]!.upstreamAttempts[0]).toMatchObject({
        state: "succeeded",
        accountId: f.hosted.activeAccountId,
      });
      expect(await dispatch(f)).toMatchObject({
        state: "dispatch_may_have_started",
        nativeEffectState: "completed",
        terminalReceiptJson: null,
      });
      await expect(
        confirmOriginalHostedReviewBinding({
          ...f.bindingInput,
          original: f.hosted,
        }),
      ).resolves.toBe(false);
      await expect(
        confirmOriginalHostedReviewBindingForCompletion({
          ...f.bindingInput,
          original: f.hosted,
        }),
      ).resolves.toBe(true);
      f.expireRunBearer();
      const settlement = completed(f, raw);
      const settled = await f.settle(receiptToken, settlement);
      expect(settled.status, await settled.clone().text()).toBe(200);
      const repeated = await f.settle(receiptToken, settlement);
      expect(repeated.status).toBe(200);
      expect(await dispatch(f)).toMatchObject({
        state: "completed",
        nativeEffectState: "completed",
      });
      expect((await f.claim(2)).status).toBe(401);
      expect((await f.request()).status).toBe(401);
      expect(f.seen).toHaveLength(1);
    });

    it("never replays an uncertain paid request or reclaims its original native budget", async () => {
      const f = await fixture("disconnect", 2);
      await claim(f);
      expect((await f.request()).status).toBe(502);
      const first = await native(f);
      expect(first).toMatchObject({
        requestCount: 1,
        activeAccountId: f.hosted.activeAccountId,
        failoverCount: 0,
      });
      expect(first.relayRequests).toHaveLength(1);
      expect(first.relayRequests[0]!.upstreamAttempts).toHaveLength(1);
      expect(first.relayRequests[0]!.upstreamAttempts[0]!.state).toBe(
        "terminal_unknown",
      );
      const restored = await f.claim();
      const restoredBody = await restored.json();
      expect(restoredBody).toMatchObject({ status: "restored" });
      expect(restoredBody).not.toHaveProperty("receiptToken");
      expect((await f.claim(2)).status).toBe(409);
      expect((await f.request()).status).toBe(409);
      expect(f.seen).toHaveLength(1);
      expect(await native(f)).toMatchObject({
        requestCount: 1,
        failoverCount: 0,
      });
      expect((await dispatch(f)).state).toBe("dispatch_may_have_started");
    });

    it.each([401, 429] as const)(
      "does not switch the original account after provider %s even with legacy failover enabled",
      async (status) => {
        const f = await fixture(status, 2);
        await claim(f);
        expect((await f.request()).status).toBe(502);
        expect(f.seen.map((request) => request.account)).toEqual([
          f.hosted.activeAccountId,
        ]);
        expect(f.sessions).toEqual([f.hosted.activeAccountId]);
        expect(await native(f)).toMatchObject({
          activeAccountId: f.hosted.activeAccountId,
          failoverCount: 0,
          requestCount: 1,
        });
        expect((await f.claim(2)).status).toBe(409);
      },
    );

    it("keeps a consumed HTTP200 without semantic terminal/usage pending and rejects incomplete receipts", async () => {
      const f = await fixture("semantic_incomplete", 2);
      const receiptToken = await claim(f);
      const response = await f.request();
      const raw = Buffer.from(await response.arrayBuffer());
      expect(response.status, raw.toString("utf8")).toBe(200);
      expect(await dispatch(f)).toMatchObject({
        state: "dispatch_may_have_started",
        nativeEffectState: "completed",
        terminalReceiptJson: null,
      });
      expect((await f.claim(2)).status).toBe(409);
      const receipt = {
        version: 2,
        routeIdentityHash: f.budget.routeIdentityHash,
        providerRequestEnvelopeHash: f.context().providerRequestEnvelopeHash,
        actualModel: f.budget.model,
        responseHash: hash(raw),
        responseBytes: raw.byteLength,
        fullyConsumed: true,
        terminal: "completed",
      };
      expect(
        (await f.settle(receiptToken, { state: "completed", receipt })).status,
      ).toBe(400);
      const overCeiling = await f.settle(receiptToken, {
        state: "completed",
        receipt: {
          ...receipt,
          usage: {
            inputTokens: 10,
            outputTokens: f.budget.maxOutputTokens + 1,
            totalTokens: f.budget.maxOutputTokens + 11,
          },
        },
      });
      expect(overCeiling.status).toBeGreaterThanOrEqual(400);
      expect((await dispatch(f)).state).toBe("dispatch_may_have_started");
      expect((await f.claim(2)).status).toBe(409);
      expect(f.seen).toHaveLength(1);
    });
  },
);
