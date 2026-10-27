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
type Fact = {
  id: string;
  text?: string;
  document_id?: string;
  tags?: string[];
  source_memory_ids?: string[];
};
type Document = { id: string; original_text: string; tags: string[] };

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
  const originalFacts = await request<{ items: Fact[] }>(
    path(`/memories/list?document_id=${documentId}&state=valid&limit=100`),
  );
  assert(originalFacts.items.length > 0);
  const observation = await eventually(async () => {
    const page = await request<{ items: Fact[] }>(
      path("/memories/list?type=observation&state=valid&limit=100"),
    );
    return page.items[0];
  }, "native derived observation for production cleanup");
  const marker = `supporting-evidence-${randomUUID()}`;
  const survivorDocumentId = `support-${randomUUID()}`;
  input.stub.setObservationUpdateFixture({
    observationId: observation.id,
    sourceMarker: marker,
  });
  try {
    await retain(
      survivorDocumentId,
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
  const sql = async (statement: string) =>
    (
      await docker(
        nativeSqlObserverArguments(actualDsn, input.imageDigest, statement),
      )
    ).trim();
  const originalHistoryCount = () =>
    sql(
      `SELECT count(*) FROM public.observation_history WHERE bank_id='${bank}' AND observation_id='${observation.id}'::uuid`,
    );
  assert(
    Number(await originalHistoryCount()) > 0,
    "Persisted native history fixture must be nonvacuous",
  );
  // Native retag deletes the live observation without cascading its history.
  // Then replacement removes the old source IDs too: a current-entry inventory
  // can no longer discover that historical body through either live identity.
  await request(path(`/documents/${documentId}`), "PATCH", {
    tags: ["kind:rule", "topic:historical-scope"],
    observation_scopes: [["kind:rule", "topic:historical-scope"]],
  });
  const replacementOperation = await retain(
    documentId,
    `Native qualification derived observation current replacement source ${privacySentinel}.`,
  );
  const currentFacts = await request<{ items: Fact[] }>(
    path(`/memories/list?document_id=${documentId}&state=valid&limit=100`),
  );
  const historicalIds = new Set(originalFacts.items.map((fact) => fact.id));
  assert(
    currentFacts.items.length > 0 &&
      currentFacts.items.every((fact) => !historicalIds.has(fact.id)),
    "Historical fixture must replace every original source identity",
  );
  assert.equal(
    await sql(
      `SELECT count(*) FROM public.memory_units WHERE bank_id='${bank}' AND id='${observation.id}'::uuid`,
    ),
    "0",
  );
  assert(
    Number(await originalHistoryCount()) > 0,
    "Retagged history must survive its deleted observation and replaced source before cleanup",
  );
  const currentIds = new Set(currentFacts.items.map((fact) => fact.id));
  await eventually(async () => {
    const page = await request<{ items: Fact[] }>(
      path("/memories/list?type=observation&state=valid&limit=100"),
    );
    return page.items.some((fact) =>
      fact.source_memory_ids?.some((source) => currentIds.has(source)),
    )
      ? true
      : undefined;
  }, "current replacement has a native observation before cleanup");
  const survivorSnapshot = async () => {
    const document = await request<Document>(
      path(`/documents/${survivorDocumentId}`),
    );
    const facts = await request<{ items: Fact[] }>(
      path(
        `/memories/list?document_id=${survivorDocumentId}&state=valid&limit=100`,
      ),
    );
    assert(facts.items.length > 0);
    return {
      id: document.id,
      body: document.original_text,
      tags: [...document.tags].sort(),
      facts: facts.items
        .map(({ id, text, document_id, tags }) => ({
          id,
          text,
          document_id,
          tags: [...(tags ?? [])].sort(),
        }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    };
  };
  // A separate native observation with its own nonempty history must survive byte-for-byte.
  const unrelatedDocumentId = `unrelated-${randomUUID()}`;
  await retain(
    unrelatedDocumentId,
    `Native qualification derived observation unrelated primary ${randomUUID()}.`,
  );
  const unrelatedFacts = await request<{ items: Fact[] }>(
    path(
      `/memories/list?document_id=${unrelatedDocumentId}&state=valid&limit=100`,
    ),
  );
  const unrelatedFactIds = new Set(unrelatedFacts.items.map((fact) => fact.id));
  const unrelatedObservation = await eventually(async () => {
    const page = await request<{ items: Fact[] }>(
      path("/memories/list?type=observation&state=valid&limit=100"),
    );
    return page.items.find((fact) =>
      fact.source_memory_ids?.some((id) => unrelatedFactIds.has(id)),
    );
  }, "unrelated native observation");
  const unrelatedMarker = `unrelated-update-${randomUUID()}`;
  input.stub.setObservationUpdateFixture({
    observationId: unrelatedObservation.id,
    sourceMarker: unrelatedMarker,
  });
  try {
    await retain(
      `unrelated-support-${randomUUID()}`,
      `Native qualification derived observation unrelated support ${unrelatedMarker}.`,
    );
    await eventually(async () => {
      const history = await request<unknown[]>(
        path(`/memories/${unrelatedObservation.id}/history`),
      );
      return history.length > 0 ? true : undefined;
    }, "unrelated nonempty observation history");
  } finally {
    input.stub.setObservationUpdateFixture(undefined);
  }
  const unrelatedSnapshot = async () =>
    sql(`SELECT jsonb_build_object(
    'observation',(SELECT to_jsonb(m) FROM public.memory_units m WHERE bank_id='${bank}' AND id='${unrelatedObservation.id}'::uuid),
    'history',(SELECT jsonb_agg(to_jsonb(h) ORDER BY id) FROM public.observation_history h WHERE bank_id='${bank}' AND observation_id='${unrelatedObservation.id}'::uuid))::text`);
  const unrelatedBefore = await unrelatedSnapshot();
  const survivorBefore = await survivorSnapshot();
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
  let pauseBinding = binding;
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
        binding: pauseBinding,
        submissionsPaused: true,
        maintenance: {
          generation: pauseBinding.generation,
          epoch: pauseBinding.pauseEpoch,
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
    const plan = {
      profile: "docker-complete-inventory-v1",
      binding,
      nativeBankId: bank,
      deploymentLabel: `io.reviewrouter.hindsight.deployment=${input.run}`,
      executorContainerIds: ids,
      apiContainerId: api.Id,
      restartContainerIds: ids,
      trackedOperationIds: [targetOperation, replacementOperation],
      routerPauseCheckUrl: `http://127.0.0.1:${address.port}/synthetic-router-maintenance-attestation`,
      deploymentLockPath: join(directory, "deployment.lock"),
      sourceInventoryPath: join(directory, "source-inventory.json"),
    } as const;
    const credentials = {
      nativeServiceKey: input.serviceKey,
      routerOperatorToken: operatorToken,
      signingKeyId: "synthetic-qualification-key",
      signingPrivateKey: privatePem,
      signingPublicKey: publicPem,
    };
    const qualification = {
      inspectCleanupDiagnostics: (text: string) =>
        assert(
          !text.includes(privacySentinel),
          "Production cleanup API diagnostics leaked synthetic content/credentials",
        ),
    };
    const receipt = await runDockerHindsightCleanup(
      plan,
      credentials,
      qualification,
    );
    // Retry from the same signed inventory after document/history/operation removal.
    const retriedReceipt = await runDockerHindsightCleanup(
      plan,
      credentials,
      qualification,
    );
    assert.deepEqual(
      retriedReceipt.proof.entryHistoryCoverage,
      receipt.proof.entryHistoryCoverage,
    );
    assert.equal(await unrelatedSnapshot(), unrelatedBefore);
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
    assert.equal(await originalHistoryCount(), "0");
    assert.deepEqual(await survivorSnapshot(), survivorBefore);
    // Requeueing a survivor must lead to real native consolidation after restart,
    // not just preserve an inert document. The public request avoids waiting for
    // the native five-minute reconciliation timer in this bounded fixture.
    await request(path("/consolidate"), "POST");
    const survivorIds = new Set(survivorBefore.facts.map((fact) => fact.id));
    await eventually(async () => {
      const page = await request<{ items: Fact[] }>(
        path("/memories/list?type=observation&state=valid&limit=100"),
      );
      assert(
        page.items.every((fact) =>
          fact.source_memory_ids?.every(
            (source) => !historicalIds.has(source) && !currentIds.has(source),
          ),
        ),
      );
      return page.items.some((fact) =>
        fact.source_memory_ids?.some((source) => survivorIds.has(source)),
      )
        ? true
        : undefined;
    }, "surviving approved source reconsolidates without forgotten evidence");
    assert.equal(await originalHistoryCount(), "0");
    assert.deepEqual(await survivorSnapshot(), survivorBefore);
    assert.equal(await unrelatedSnapshot(), unrelatedBefore);
    // A raw async retain that never reached extraction has no fact ledger rows.
    // Stop normal executors before enqueueing it, then resume only through the operator.
    for (const id of ids) await docker(["stop", "--time", "30", id]);
    await docker(["start", api.Id]);
    await eventually(async () => {
      try {
        return (await fetch(`${input.base}/health/ready`)).ok
          ? true
          : undefined;
      } catch {
        return undefined;
      }
    }, "API-only queued raw fixture");
    const zeroEntryId = randomUUID();
    const zeroOperation = randomUUID();
    await request(path("/memories"), "POST", {
      items: [
        {
          document_id: `entry-${zeroEntryId}`,
          content: `Pending raw source ${privacySentinel}.`,
          strategy: "router-approved-v1",
          update_mode: "replace",
        },
      ],
      async: true,
      operation_id: zeroOperation,
    });
    assert.equal(
      (await request<Operation>(path(`/operations/${zeroOperation}`))).status,
      "pending",
    );
    pauseBinding = {
      ...binding,
      entryId: zeroEntryId,
      forgetCommandId: randomUUID(),
    };
    const zeroReceipt = await runDockerHindsightCleanup(
      {
        ...plan,
        binding: pauseBinding,
        trackedOperationIds: [zeroOperation],
        sourceInventoryPath: join(directory, "zero-source-inventory.json"),
      },
      credentials,
      qualification,
    );
    assert.equal(zeroReceipt.proof.sourceInventory.sourceFactCount, 0);
    assert(zeroReceipt.proof.entryHistoryCoverage.operationCount > 0);
    assert.equal(await unrelatedSnapshot(), unrelatedBefore);
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
      "orphan-history-from-retagged-observation-and-replaced-source-erased",
      "surviving-approved-source-unchanged-and-natively-reconsolidated",
      "unrelated-observation-and-nonempty-history-preserved-byte-for-byte",
      "signed-inventory-retry-and-zero-fact-pending-raw-cleanup-after-restart",
      "signed-receipt-exact-source-inventory-current-pause-binding",
    ];
  } finally {
    pauseServer.closeAllConnections();
    await new Promise<void>((resolve) => pauseServer.close(() => resolve()));
  }
}
