import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import * as c from "@agent-teams/account-gateway/contracts";
import { createLifecycleV3Client } from "@agent-teams/account-gateway/http";
import { createAccountLifecycleReader } from "./account-lifecycle-reader";
import { createAccountsOverview } from "./accounts-overview";

it("bounds 100-account inventory against stalled SDK response bodies and recovers the same page service", async () => {
  let healthy = false;
  let active = 0;
  let peak = 0;
  let requests = 0;
  let closed!: () => void;
  const socketsClosed = new Promise<void>((resolve) => {
    closed = resolve;
  });
  const server = createServer((request, response) => {
    requests++;
    active++;
    peak = Math.max(peak, active);
    response.on("close", () => {
      active--;
      if (!active) closed();
    });
    response.writeHead(200, { "content-type": "application/json" });
    if (!healthy) {
      response.write("{");
      return;
    }
    const accountRef = request.url!.split("/").at(-1)!;
    response.end(
      JSON.stringify({
        accountRef,
        ownerRef: "workspace-owner",
        profileId: "mimo",
        displayName: accountRef,
        state: "active",
        metadataRevision: 1,
        authorizationEpoch: 1,
        authKind: "api_key",
        resumeCustody: "not_applicable",
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const gateway = createAccountLifecycleReader({
      contract: "account-lifecycle/v3",
      lifecycle: createLifecycleV3Client({
        role: "management",
        origin,
        token: "inventory-test-token",
        timeoutMs: 10_000,
        responseBytes: 65536,
        capability: c.LIFECYCLE_V3_CAPABILITY_CONTRACT,
        clientContract: c.LIFECYCLE_V3_CLIENT_CONTRACT,
      }),
      legacy: {
        get: async () => {
          throw new Error("legacy_not_expected");
        },
      },
    });
    const rows = Array.from({ length: 101 }, (_, index) => ({
      id: `source-${String(index).padStart(3, "0")}`,
      ownerUserId: null,
      ownerWorkspaceId: "workspace",
      gatewayAccountRef: `account-${String(index).padStart(3, "0")}`,
      profileRef: "mimo",
      displayName: `local-${index}`,
      state: "active",
      metadataRevision: 1,
      authorizationEpochMirror: null,
      pendingSourceOperationId: null,
      bindingId: null,
      bindingRevision: null,
      bindingState: null,
      fencePending: false,
      role: "admin",
      workspaceName: "Workspace",
    }));
    const overview = createAccountsOverview({
      prisma: {
        $queryRaw: async () => rows,
        user: { findMany: async () => [] },
      } as unknown as PrismaClient,
      cursorSecret: "inventory-test-cursor",
      gateway,
      profiles: [{ id: "mimo", label: "MiMo", authKind: "api_key" }],
      authorize: async () => ({ workspaceId: "workspace", userId: "viewer" }),
      visibleRepositoryIds: async () => null,
      ownerRef: () => "workspace-owner",
    });
    const started = performance.now();
    const unavailable = await overview.list({ limit: 100 });
    const elapsed = performance.now() - started;
    expect(unavailable.status).toBe("ok");
    if (unavailable.status !== "ok") throw new Error("inventory_expected");
    expect(unavailable.value.accounts).toHaveLength(100);
    expect(
      unavailable.value.accounts.every(
        (account) => account.readiness === "unknown",
      ),
    ).toBe(true);
    expect(unavailable.value.nextCursor).not.toBeNull();
    expect(requests).toBe(4);
    expect(peak).toBe(4);
    expect(elapsed).toBeLessThan(4500);
    await Promise.race([
      socketsClosed,
      new Promise<never>((_resolve, reject) => {
        closeTimer = setTimeout(
          () => reject(new Error("stalled_sdk_sockets_retained")),
          500,
        );
      }),
    ]);
    clearTimeout(closeTimer);
    expect(active).toBe(0);
    healthy = true;
    const recovered = await overview.list({ limit: 100 });
    expect(recovered.status).toBe("ok");
    if (recovered.status !== "ok") throw new Error("inventory_expected");
    expect(recovered.value.accounts).toHaveLength(100);
    expect(
      recovered.value.accounts.every(
        (account) => account.readiness === "ready",
      ),
    ).toBe(true);
    expect(
      recovered.value.accounts.map((account) => account.connectionId),
    ).toEqual(rows.slice(0, 100).map((row) => row.id));
    expect(requests).toBe(104);
    expect(peak).toBeLessThanOrEqual(4);
  } finally {
    clearTimeout(closeTimer);
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}, 10_000);
