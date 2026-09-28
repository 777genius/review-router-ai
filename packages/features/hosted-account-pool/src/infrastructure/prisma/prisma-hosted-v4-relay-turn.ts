import { Prisma, type PrismaClient } from "@prisma/client";
import type { HostedV4RelayTurnPort } from "../../application/ports/hosted-v4-relay-turn-port";
import {
  canonicalScope,
  type HostedV4RelayGrantContract,
} from "../../domain/hosted-v4-relay-grant";

/** Sticky turn history. Reissue with a replacement lease cannot reset it. */
export class PrismaHostedV4RelayTurn implements HostedV4RelayTurnPort {
  constructor(private readonly prisma: PrismaClient) {}

  async reserve(contract: HostedV4RelayGrantContract): Promise<void> {
    if (contract.expiresAt <= new Date())
      throw new Error("hosted_v4_relay_turn_expired");
    await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw(Prisma.sql`
        INSERT INTO "HostedCodexV4RelayTurn"
          ("logicalTurnKey", "scopeHash", "scopeCanonical", "authorizationId",
           "investigationId", "turnId", "expiresAt", "maxRequests",
           "maxRequestBytes", "maxResponseBytes", "maxOutputTokens",
           "state", "updatedAt")
        VALUES (${contract.logicalTurnKey}, ${contract.scopeHash},
                ${canonicalScope(contract.scope)}, ${contract.scope.authorizationId},
                ${contract.scope.investigationId}, ${contract.scope.turnId},
                ${contract.expiresAt}, ${contract.maxRequests},
                ${contract.maxRequestBytes}, ${contract.maxResponseBytes},
                ${contract.maxOutputTokens},
                'open', CURRENT_TIMESTAMP)
        ON CONFLICT ("logicalTurnKey") DO NOTHING
      `);
        await assertOpenLocked(tx, contract);
      },
      { isolationLevel: "Serializable" },
    );
  }

  async assertOpen(contract: HostedV4RelayGrantContract): Promise<void> {
    await this.prisma.$transaction(
      async (tx) => {
        await assertOpenLocked(tx, contract);
      },
      { isolationLevel: "Serializable" },
    );
  }

  async markTerminalUnknown(logicalTurnKey: string, at: Date): Promise<void> {
    if (
      !/^[a-f0-9]{64}$/.test(logicalTurnKey) ||
      !Number.isFinite(at.getTime())
    ) {
      throw new Error("hosted_v4_relay_turn_invalid");
    }
    await this.prisma.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<Array<{ state: string }>>(Prisma.sql`
        SELECT "state" FROM "HostedCodexV4RelayTurn"
        WHERE "logicalTurnKey" = ${logicalTurnKey} FOR UPDATE
      `);
        if (rows.length !== 1) throw new Error("hosted_v4_relay_turn_missing");
        if (rows[0]?.state !== "terminal_unknown") {
          await tx.hostedCodexV4RelayTurn.update({
            where: { logicalTurnKey },
            data: { state: "terminal_unknown", unknownAt: at },
          });
        }
        await tx.hostedCodexInvocationGrant.updateMany({
          where: {
            v4TurnKey: logicalTurnKey,
            status: { in: ["issued", "exhausted"] },
          },
          data: {
            status: "revoked",
            revokedAt: at,
            revision: { increment: 1 },
          },
        });
      },
      { isolationLevel: "Serializable" },
    );
  }
}

async function assertOpenLocked(
  tx: Prisma.TransactionClient,
  contract: HostedV4RelayGrantContract,
): Promise<void> {
  const rows = await tx.$queryRaw<
    Array<{
      scopeHash: string;
      scopeCanonical: string;
      state: string;
      expiresAt: Date;
      maxRequests: number;
      maxRequestBytes: number;
      maxResponseBytes: number;
      maxOutputTokens: number;
    }>
  >(Prisma.sql`
    SELECT "scopeHash", "scopeCanonical", "state", "expiresAt",
           "maxRequests", "maxRequestBytes", "maxResponseBytes", "maxOutputTokens"
    FROM "HostedCodexV4RelayTurn"
    WHERE "logicalTurnKey" = ${contract.logicalTurnKey} FOR UPDATE
  `);
  const saved = rows[0];
  if (!saved || saved.state !== "open") {
    throw new Error("hosted_v4_relay_turn_terminal_unknown");
  }
  if (saved.expiresAt <= new Date())
    throw new Error("hosted_v4_relay_turn_expired");
  if (
    saved.scopeHash !== contract.scopeHash ||
    saved.scopeCanonical !== canonicalScope(contract.scope) ||
    saved.expiresAt.getTime() !== contract.expiresAt.getTime() ||
    saved.maxRequests !== contract.maxRequests ||
    saved.maxRequestBytes !== contract.maxRequestBytes ||
    saved.maxResponseBytes !== contract.maxResponseBytes ||
    saved.maxOutputTokens !== contract.maxOutputTokens
  ) {
    throw new Error("hosted_v4_relay_turn_scope_conflict");
  }
}
