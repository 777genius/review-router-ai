import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import {
  hindsightCleanupBankDigest,
  hindsightCleanupDigest,
  verifyHindsightCleanupReceipt,
  type HindsightCleanupBinding,
} from "../../packages/features/memory/src/infrastructure/hindsight/hindsight-cleanup-receipt.ts";
import { runDockerHindsightCleanup } from "./cleanup-operator.ts";
import { dockerCommand as docker, eventually } from "./native-runtime.ts";
import { nativeSqlObserverArguments } from "./operator-host.ts";
import { privacySentinel, type startProviderStub } from "./provider-stub.ts";

type Operation = {
  operation_id: string;
  status: string;
  child_operations?: Operation[];
};
type Fact = { id: string; source_memory_ids?: string[] };

/** Native/host qualification only. Router's maintenance HTTP attestation is a declared fixture. */
export async function qualifyProductionCleanup(input: {
  readonly base: string;
  readonly serviceKey: string;
  readonly imageDigest: string;
  readonly run: string;
  readonly output: string;
  readonly normalContainerNames: readonly string[];
  readonly stub: Awaited<ReturnType<typeof startProviderStub>>;
}): Promise<readonly string[]> {
  const bank = `${input.run}-operator-cleanup`;
  const entryId = randomUUID();
  const documentId = `entry-${entryId}`;
  const path = (suffix: string) => `/v1/default/banks/${bank}${suffix}`;
  async function request<T>(
    url: string,
    method = "GET",
    body?: unknown,
    expected = 200,
  ): Promise<T> {
    const response = await fetch(`${input.base}${url}`, {
      method,
      headers: {
        Authorization: `Bearer ${input.serviceKey}`,
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(10_000),
    });
    assert.equal(
      response.status,
      expected,
      "Production operator fixture native request failed; raw body suppressed",
    );
    return (await response.json()) as T;
  }
  async function retain(document: string, body: string): Promise<string> {
    const operationId = randomUUID();
    await request(path("/memories"), "POST", {
      items: [
        {
          document_id: document,
          content: body,
          tags: ["kind:rule"],
          timestamp: "2026-01-02T03:04:05Z",
          strategy: "router-approved-v1",
          update_mode: "replace",
          observation_scopes: [["kind:rule"]],
        },
      ],
      async: true,
      operation_id: operationId,
    });
    await eventually(async () => {
      const state = await request<Operation>(
        path(`/operations/${operationId}`),
      );
      if (!["completed", "failed", "cancelled"].includes(state.status))
        return undefined;
      assert.equal(state.status, "completed");
      assert(
        state.child_operations?.every((child) => child.status === "completed"),
      );
      return true;
    }, "operator fixture retain completion");
    return operationId;
  }
  await request(path(""), "PUT", {
    name: "Synthetic production cleanup qualification",
  });
  await request(path("/config"), "PATCH", {
    updates: {
      audit_log_enabled: false,
      store_document_text: true,
      retain_strategies: {
        "router-approved-v1": { retain_extraction_mode: "chunks" },
      },
      retain_default_strategy: "router-approved-v1",
      enable_observations: true,
      enable_auto_consolidation: true,
      default_observation_scopes: [["kind:rule"]],
    },
  });
  const targetOperation = await retain(
    documentId,
    `Native qualification derived observation reviewed primary source ${privacySentinel}.`,
  );
  const observation = await eventually(async () => {
    const page = await request<{ items: Fact[] }>(
      path("/memories/list?type=observation&state=valid&limit=100"),
    );
    return page.items[0];
  }, "native derived observation for production cleanup");
  const marker = `supporting-evidence-${randomUUID()}`;
  input.stub.setObservationUpdateFixture({
    observationId: observation.id,
    sourceMarker: marker,
  });
  try {
    await retain(
      `support-${randomUUID()}`,
      `Native qualification derived observation supporting source ${marker}.`,
    );
    await eventually(async () => {
      const history = await request<unknown[]>(
        path(`/memories/${observation.id}/history`),
      );
      return history.length > 0 ? true : undefined;
    }, "nonempty native observation history before forget");
  } finally {
    input.stub.setObservationUpdateFixture(undefined);
  }
  const apiName = input.normalContainerNames.find((name) =>
    name.endsWith("-api"),
  );
  assert(apiName);
  const api = JSON.parse(
    await docker(["inspect", "--format", "{{json .}}", apiName]),
  ) as { Id: string; Config: { Env: string[] } };
  const actualDsn = api.Config.Env.find((value) =>
    value.startsWith("HINDSIGHT_API_DATABASE_URL="),
  )?.slice("HINDSIGHT_API_DATABASE_URL=".length);
  assert(actualDsn);
  assert(
    Number(
      (
        await docker(
          nativeSqlObserverArguments(
            actualDsn,
            input.imageDigest,
            `SELECT count(*) FROM public.observation_history WHERE bank_id='${bank}' AND observation_id='${observation.id}'::uuid`,
          ),
        )
      ).trim(),
    ) > 0,
    "Persisted native history fixture must be nonvacuous",
  );
  const ids = await Promise.all(
    input.normalContainerNames.map(async (name) =>
      (await docker(["inspect", "--format", "{{.Id}}", name])).trim(),
    ),
  );
  const binding: HindsightCleanupBinding = {
    namespace: "native-qualification",
    generation: input.run,
    scopeDigest: hindsightCleanupDigest({ bank }),
    bankIdDigest: hindsightCleanupBankDigest(bank),
    entryId,
    forgetCommandId: randomUUID(),
    imageDigest: input.imageDigest,
    pauseEpoch: "1",
  };
  const operatorToken = `synthetic-router-operator-${randomUUID()}`;
  const pauseServer = createServer((request, response) => {
    if (
      request.method !== "GET" ||
      request.headers.authorization !== `Bearer ${operatorToken}`
    ) {
      response.writeHead(403);
      response.end("{}");
      return;
    }
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({
        binding,
        submissionsPaused: true,
        maintenance: {
          generation: binding.generation,
          epoch: binding.pauseEpoch,
          paused: true,
        },
      }),
    );
  });
  await new Promise<void>((resolve) =>
    pauseServer.listen(0, "127.0.0.1", resolve),
  );
  const address = pauseServer.address();
  assert(address && typeof address !== "string");
  const directory = join(input.output, "production-cleanup");
  await mkdir(directory, { mode: 0o700 });
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const privatePem = privateKey
    .export({ type: "pkcs8", format: "pem" })
    .toString();
  const publicPem = publicKey
    .export({ type: "spki", format: "pem" })
    .toString();
  try {
    const receipt = await runDockerHindsightCleanup(
      {
        profile: "docker-complete-inventory-v1",
        binding,
        nativeBankId: bank,
        deploymentLabel: `io.reviewrouter.hindsight.deployment=${input.run}`,
        executorContainerIds: ids,
        apiContainerId: api.Id,
        restartContainerIds: ids,
        trackedOperationIds: [targetOperation],
        routerPauseCheckUrl: `http://127.0.0.1:${address.port}/synthetic-router-maintenance-attestation`,
        deploymentLockPath: join(directory, "deployment.lock"),
        sourceInventoryPath: join(directory, "source-inventory.json"),
      },
      {
        nativeServiceKey: input.serviceKey,
        routerOperatorToken: operatorToken,
        signingKeyId: "synthetic-qualification-key",
        signingPrivateKey: privatePem,
        signingPublicKey: publicPem,
      },
      {
        inspectCleanupDiagnostics: (text) =>
          assert(
            !text.includes(privacySentinel),
            "Production cleanup API diagnostics leaked synthetic content/credentials",
          ),
      },
    );
    assert(
      verifyHindsightCleanupReceipt(
        receipt,
        binding,
        { "synthetic-qualification-key": publicPem },
        new Date(),
      ),
    );
    assert(
      receipt.proof.sourceInventory.observationCount > 0,
      "Production forget evidence must include derived observations",
    );
    await writeFile(
      join(directory, "receipt.json"),
      JSON.stringify(receipt, null, 2) + "\n",
      { mode: 0o600 },
    );
    await writeFile(
      join(directory, "qualification-boundary.json"),
      JSON.stringify(
        {
          nativeHostProfile:
            "actual Docker processes + exact API DSN + PG17 + public native APIs + signed operator CLI",
          routerMaintenanceAttestation:
            "synthetic HTTP fixture; durable Router transport barrier requires separate real-PG vertical qualification",
          realModelQualityQualified: false,
        },
        null,
        2,
      ) + "\n",
    );
    return [
      "production-cleanup-cli-real-flock-complete-inventory-api-worker-db-barrier",
      "nonvacuous-derived-observation-history-physically-absent-after-native-delete-and-restart",
      "signed-receipt-exact-source-inventory-current-pause-binding",
    ];
  } finally {
    pauseServer.closeAllConnections();
    await new Promise<void>((resolve) => pauseServer.close(() => resolve()));
  }
}
