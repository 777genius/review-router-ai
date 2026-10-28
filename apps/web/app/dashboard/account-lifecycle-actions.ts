"use server";
import { z } from "zod";
import { ProviderAccountError } from "@reviewrouter/features-provider-accounts";
import { productionPersonalAccounts } from "../../src/server/personal-account-composition";
import { productionAccountLifecycle } from "../../src/server/account-lifecycle-composition";
import type { AccountLifecycleRequest } from "../../src/server/account-lifecycle";
async function invoke<T>(
  context: string,
  workspaceId: string,
  run: (
    service: Awaited<ReturnType<typeof productionAccountLifecycle>>,
  ) => Promise<T>,
) {
  try {
    const personal = await productionPersonalAccounts();
    if (!personal || personal.scope !== context)
      return { status: "denied" as const };
    const service = await productionAccountLifecycle(workspaceId);
    return { status: "ok" as const, value: await run(service) };
  } catch (error) {
    if (error instanceof z.ZodError) return { status: "invalid" as const };
    if (error instanceof ProviderAccountError)
      return {
        status:
          error.code === "operation_conflict" ||
          error.code === "revision_conflict"
            ? ("conflict" as const)
            : error.code === "invalid_input"
              ? ("invalid" as const)
              : error.code === "not_found"
                ? ("unavailable" as const)
                : ("denied" as const),
      };
    return { status: "unavailable" as const };
  }
}
export async function mutateAccountLifecycle(
  context: string,
  workspaceId: string,
  request: AccountLifecycleRequest,
) {
  return invoke(context, workspaceId, (service) =>
    service.mutate(workspaceId, request),
  );
}
export async function readAccountLifecycleOperation(
  context: string,
  workspaceId: string,
  raw: { nonce: string } | { operationId: string },
) {
  const request = z
    .union([
      z.strictObject({ nonce: z.string().uuid() }),
      z.strictObject({
        operationId: z
          .string()
          .regex(/^[A-Za-z0-9_-]+$/)
          .max(256),
      }),
    ])
    .safeParse(raw);
  if (!request.success) return { status: "invalid" as const };
  return invoke(context, workspaceId, (service) =>
    "nonce" in request.data
      ? service.readByNonce(request.data.nonce)
      : service.read(workspaceId, request.data.operationId),
  );
}
export async function readAccountLifecycleByNonce(
  context: string,
  workspaceId: string,
  nonce: string,
) {
  return readAccountLifecycleOperation(context, workspaceId, { nonce });
}

export async function continueAccountLifecycleOperation(
  context: string,
  workspaceId: string,
  operationId: string,
) {
  const parsed = z
    .string()
    .regex(/^[A-Za-z0-9_-]+$/)
    .max(256)
    .safeParse(operationId);
  if (!parsed.success) return { status: "invalid" as const };
  return invoke(context, workspaceId, (service) =>
    service.continue(workspaceId, parsed.data),
  );
}
