import type { PrismaClient } from "@prisma/client";
import { expect, it, vi } from "vitest";
import { createAccountMetadataService } from "./account-metadata-service";

it("allows cached suspended owner facts and hides a pending source operation", async () => {
  const source = {
    id: "source",
    ownerUserId: "owner",
    ownerWorkspaceId: null,
    gatewayAccountRef: "native",
    profileRef: "codex",
    state: "suspended",
    authorizationEpochMirror: 1n,
    pendingSourceOperationId: null as string | null,
    role: null,
    bindingId: null,
    bindingRevision: null,
  };
  const read = vi.fn(async () => [
    {
      accountRef: "native",
      authorizationEpoch: 1,
      metadataRevision: 1,
      info: { status: "unsupported" as const },
    },
  ]);
  const service = createAccountMetadataService({
    prisma: {
      $queryRaw: async () => [{ ...source }],
    } as unknown as PrismaClient,
    reader: { read },
    secret: "TEST-only-secret",
    authorize: async () => ({ userId: "owner" }),
    ownerRef: () => "owner-ref",
  });
  expect(
    (await service.page([{ connectionId: "source" }]))[0]?.metadata.status,
  ).toBe("unsupported");
  expect(read).toHaveBeenCalledOnce();
  source.pendingSourceOperationId = "pending-reconnect";
  read.mockClear();
  expect(
    (await service.page([{ connectionId: "source" }]))[0]?.metadata.status,
  ).toBe("unknown");
  expect(read).not.toHaveBeenCalled();
});
