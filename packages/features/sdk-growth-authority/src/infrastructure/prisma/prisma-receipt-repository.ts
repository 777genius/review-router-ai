import type { PrismaClient } from "@prisma/client";
import type {
  AuthorityLedger,
  AuthorityScope,
  ReceiptRepositoryPort,
  ReceiptSelection,
} from "../../application/ports.js";
import { equal } from "../../domain/validation.js";
import {
  storageLedger,
  storageScope,
  storageTransition,
} from "./authority-storage-validation.js";

/** Row custody serializes each scope across processes, including first creation.
 * READ COMMITTED is deliberate: the statement after a blocked insert/lock must see
 * the previous owner's commit. No callback retries (callbacks may enqueue intents).
 * A thrown callback/validation/write rolls back the complete transaction.
 */
export class PrismaReceiptRepository implements ReceiptRepositoryPort {
  constructor(private readonly prisma: PrismaClient) {}

  async transact<T>(
    scope: AuthorityScope,
    selection: ReceiptSelection,
    operation: (ledger: AuthorityLedger) => Promise<T>,
  ): Promise<T> {
    const key = storageScope(scope);
    // Grant IDs are canonical JSON tuples, not caller-supplied database keys.
    // Invalid/noncanonical IDs select nothing and preserve the public not-found result.
    let requestId: string | null = null;
    if ("requestId" in selection) requestId = selection.requestId;
    else {
      try {
        const parts: unknown = JSON.parse(selection.grantId);
        if (
          Array.isArray(parts) &&
          parts.length === 4 &&
          parts[0] === key.tenantId &&
          parts[1] === key.repositoryId &&
          parts[2] === key.pullRequest &&
          typeof parts[3] === "string" &&
          JSON.stringify(parts) === selection.grantId
        )
          requestId = parts[3];
      } catch {
        /* An opaque unknown grant ID has no tombstone. */
      }
    }
    const { tenantId, repositoryId } = key;
    const pullRequest = BigInt(key.pullRequest);
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`INSERT INTO "SdkGrowthAuthorityScope" ("tenantId", "repositoryId", "pullRequest")
        VALUES (${tenantId}, ${repositoryId}, ${pullRequest}) ON CONFLICT DO NOTHING`;
        const [row] = await tx.$queryRaw<
          { fence: bigint }[]
        >`SELECT "fence" FROM "SdkGrowthAuthorityScope"
        WHERE "tenantId" = ${tenantId} AND "repositoryId" = ${repositoryId} AND "pullRequest" = ${pullRequest} FOR UPDATE`;
        const rows = await tx.$queryRaw<
          { fence: bigint; requestId: string; metadata: unknown }[]
        >`SELECT "fence", "requestId", "metadata" FROM "SdkGrowthAuthorityRecord"
        WHERE "tenantId" = ${tenantId} AND "repositoryId" = ${repositoryId} AND "pullRequest" = ${pullRequest} AND "requestId" = ${requestId}`;
        const before = storageLedger(
          {
            fence: Number(row?.fence),
            records: rows.map((item) => item.metadata),
          } as AuthorityLedger,
          key,
        );
        rows.forEach((item, index) => {
          const grant = before.records[index]!.grant;
          if (
            BigInt(grant.fence) !== item.fence ||
            grant.request.requestId !== item.requestId
          )
            throw new Error("Invalid SDK authority storage keys");
        });
        const draft = structuredClone(before);
        const result = await operation(draft);
        // Capture both before any subsequent await: caller-held drafts/results cannot alias custody.
        const after = storageLedger(draft, key);
        const output = structuredClone(result);
        storageTransition(before, after);
        if (
          after.records.some(
            (record) => record.grant.request.requestId !== requestId,
          )
        )
          throw new Error("Invalid SDK authority storage selection");
        for (let index = 0; index < after.records.length; index++) {
          const record = after.records[index]!;
          if (equal(record, before.records[index])) continue;
          const fence = BigInt(record.grant.fence);
          const metadata = JSON.stringify(record);
          if (index < before.records.length) {
            await tx.$executeRaw`UPDATE "SdkGrowthAuthorityRecord" SET "metadata" = ${metadata}::jsonb
            WHERE "tenantId" = ${tenantId} AND "repositoryId" = ${repositoryId} AND "pullRequest" = ${pullRequest} AND "fence" = ${fence}`;
          } else {
            await tx.$executeRaw`INSERT INTO "SdkGrowthAuthorityRecord" ("tenantId", "repositoryId", "pullRequest", "fence", "requestId", "metadata")
            VALUES (${tenantId}, ${repositoryId}, ${pullRequest}, ${fence}, ${record.grant.request.requestId}, ${metadata}::jsonb)`;
          }
        }
        if (after.fence !== before.fence)
          await tx.$executeRaw`UPDATE "SdkGrowthAuthorityScope" SET "fence" = ${BigInt(after.fence)}
        WHERE "tenantId" = ${tenantId} AND "repositoryId" = ${repositoryId} AND "pullRequest" = ${pullRequest}`;
        return output;
      },
      { isolationLevel: "ReadCommitted" },
    );
  }
}
