import { Prisma, type PrismaClient } from "@prisma/client";
import {
  confirmWebhookRecovery,
  pollWebhookRecovery,
  prepareWebhookRecovery,
  recordWebhookRedeliveryAccepted,
  requestWebhookRedeliveryOnce,
  reserveWebhookRedeliveryOnce,
  type RedeliveryRequestOutcome,
  type WebhookRecoveryIdentity,
} from "@reviewrouter/features-github-installations";
import { GitHubAppWebhookRecoveryAuthority } from "./github-app-webhook-recovery-authority.js";
import type { GitHubAppWebhookRedeliveryClient } from "./github-app-webhook-redelivery-client.js";

export type WebhookRecoveryCommand = Readonly<{
  mode: "inspect" | "request" | "reconcile";
  deliveryGuid: string;
  githubDeliveryId: bigint;
}>;

type ReceiverRow = {
  eventName: string;
  action: string | null;
  installationId: bigint | null;
  payloadHash: string | null;
  status: string;
  appIdentityHash: string | null;
  recoveryState: string | null;
  githubDeliveryId: bigint | null;
  recoveryIdentityMatches: boolean;
};

export function validateWebhookRecoveryCommand(
  command: WebhookRecoveryCommand,
): void {
  if (
    !["inspect", "request", "reconcile"].includes(command.mode) ||
    !command.deliveryGuid ||
    command.deliveryGuid.length > 200 ||
    Array.from(command.deliveryGuid).some((character) => {
      const code = character.charCodeAt(0);
      return code <= 0x20 || code === 0x7f;
    }) ||
    typeof command.githubDeliveryId !== "bigint" ||
    command.githubDeliveryId < 1n ||
    command.githubDeliveryId > BigInt(Number.MAX_SAFE_INTEGER)
  )
    throw new Error("webhook_recovery_command_invalid");
}

/** Explicit recovery of one known, authenticated receipt; never discovery or bulk replay. */
export async function runKnownWebhookRecovery(
  command: WebhookRecoveryCommand,
  dependencies: Readonly<{
    prisma: PrismaClient;
    client: GitHubAppWebhookRedeliveryClient;
  }>,
) {
  validateWebhookRecoveryCommand(command);
  const { prisma, client } = dependencies;
  const readReceiver = async (
    reader: Pick<PrismaClient, "$queryRaw"> = prisma,
  ) => {
    const rows = await reader.$queryRaw<ReceiverRow[]>(Prisma.sql`
      SELECT d."eventName", d.action, d."installationId", d."payloadHash", d.status,
        f."appIdentityHash", r.state AS "recoveryState", r."githubDeliveryId",
        COALESCE(r."eventName"=d."eventName" AND r.action IS NOT DISTINCT FROM d.action
          AND r."installationId" IS NOT DISTINCT FROM d."installationId"
          AND r."payloadHash"=d."payloadHash", FALSE) AS "recoveryIdentityMatches"
      FROM "GitHubWebhookDelivery" d
      LEFT JOIN "GitHubWebhookFence" f USING ("deliveryId")
      LEFT JOIN "GitHubWebhookRecoveryIntent" r
        ON r."deliveryGuid"=d."deliveryId" AND r."appIdentityHash"=f."appIdentityHash"
      WHERE d."deliveryId"=${command.deliveryGuid}
    `);
    const row = rows[0];
    if (!row) throw new Error("webhook_recovery_delivery_not_found");
    if (!row.appIdentityHash || !row.payloadHash)
      throw new Error("webhook_recovery_authenticated_fence_required");
    if (row.appIdentityHash !== client.appIdentityHash)
      throw new Error("webhook_recovery_app_identity_mismatch");
    if (row.recoveryState !== null && !row.recoveryIdentityMatches)
      throw new Error("webhook_recovery_identity_conflict");
    if (
      row.githubDeliveryId !== null &&
      row.githubDeliveryId !== command.githubDeliveryId
    )
      throw new Error("webhook_recovery_identity_conflict");
    return {
      ...row,
      payloadHash: row.payloadHash,
      appIdentityHash: row.appIdentityHash,
    };
  };
  const receiver = await readReceiver();
  const identity: WebhookRecoveryIdentity = {
    appIdentityHash: client.appIdentityHash,
    deliveryGuid: command.deliveryGuid,
    githubDeliveryId: command.githubDeliveryId,
    eventName: receiver.eventName,
    action: receiver.action,
    installationId: receiver.installationId,
    payloadHash: receiver.payloadHash,
  };
  const summary = (row: ReceiverRow) => ({
    deliveryGuid: command.deliveryGuid,
    githubDeliveryId: command.githubDeliveryId.toString(),
    githubDeliveryIdBound: row.githubDeliveryId !== null,
    deliveryStatus: row.status,
    recoveryState: row.recoveryState,
  });
  const authority = new GitHubAppWebhookRecoveryAuthority(prisma, client);

  if (command.mode === "inspect") {
    const authorized =
      receiver.status !== "processed" &&
      (receiver.recoveryState === null ||
        receiver.recoveryState === "prepared") &&
      (await authority.authorize(identity));
    // Authorization performs HTTP outside the database; another operator may
    // reserve or finish this delivery before that observation returns.
    return prisma.$transaction(
      async (transaction) => {
        // Receipt, custody, lease and replay ordering share one local snapshot.
        // The callback performs only reads; all HTTP has already completed.
        const current = await readReceiver(transaction);
        const localAuthority = new GitHubAppWebhookRecoveryAuthority(
          transaction,
          client,
        );
        const state =
          current.status === "processed"
            ? "processed"
            : current.recoveryState !== null &&
                current.recoveryState !== "prepared"
              ? "reconciliation_required"
              : authorized &&
                  (await localAuthority.isReceiverEligible(identity))
                ? "eligible"
                : "not_authorized";
        return { ...summary(current), state };
      },
      { isolationLevel: "RepeatableRead" },
    );
  }
  if (command.mode === "reconcile" && receiver.recoveryState === null)
    return {
      ...summary(receiver),
      state: receiver.status === "processed" ? "processed" : "not_requested",
    };
  if (receiver.status === "processed" && receiver.recoveryState === null)
    return { ...summary(receiver), state: "processed" };

  let requestOutcome: RedeliveryRequestOutcome | null = null;
  if (command.mode === "request") {
    if (receiver.recoveryState === null) {
      if (!(await authority.authorize(identity))) {
        const current = await readReceiver();
        if (current.recoveryState === null)
          return {
            ...summary(current),
            state:
              current.status === "processed" ? "processed" : "not_authorized",
          };
        // Another operator may have reserved or completed while authorization was in flight.
        requestOutcome = "not_authorized";
      } else {
        await prepareWebhookRecovery(prisma, identity);
      }
    }
    if (requestOutcome === null)
      requestOutcome = await requestWebhookRedeliveryOnce(identity, {
        authority,
        client,
        custody: {
          reserve: (value, attempt) =>
            reserveWebhookRedeliveryOnce(prisma, value, attempt),
          accepted: (value, attempt) =>
            recordWebhookRedeliveryAccepted(prisma, value, attempt),
        },
      });
  }
  const result = await pollWebhookRecovery(
    identity,
    {
      client,
      custody: { confirm: (value) => confirmWebhookRecovery(prisma, value) },
    },
    { maxPolls: 3, maxPages: 5, delayMs: 1_000 },
  );
  const current = await readReceiver();
  return {
    ...summary(current),
    ...result,
    state: current.recoveryState === "confirmed" ? "confirmed" : result.state,
    requestOutcome,
  };
}
