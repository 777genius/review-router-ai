import { Prisma, type PrismaClient } from "@prisma/client";
import type { ResolutionWriterDrainQualificationPort } from "../../application/use-cases/activate-review-resolution-history";
import { SignedResolutionWriterQualification } from "../resolution-writer-witness";

/** Deployment-owned configuration selects the existing witness; review input cannot supply it. */
export function createPrismaResolutionWriterQualification(input: {
  readonly prisma: PrismaClient;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly fetch?: typeof fetch;
  readonly now?: () => Date;
}): ResolutionWriterDrainQualificationPort {
  const env = input.env;
  const unavailable: ResolutionWriterDrainQualificationPort = {
    async qualify() {
      return {
        status: "unqualified",
        reasonCode: "resolution_writer_witness_unavailable",
      };
    },
  };
  if (
    !env.REVIEW_ROUTER_RESOLUTION_WRITER_WITNESS_URL ||
    !env.REVIEW_ROUTER_RESOLUTION_WRITER_WITNESS_KEY_ID ||
    !env.REVIEW_ROUTER_RESOLUTION_WRITER_WITNESS_PUBLIC_KEY_PEM ||
    !env.REVIEW_ROUTER_RESOLUTION_WRITER_ENVIRONMENT_ID ||
    !env.REVIEW_ROUTER_RESOLUTION_WRITER_DEPLOYMENT_REVISION ||
    !env.REVIEW_ROUTER_RESOLUTION_WRITER_ARTIFACT_DIGEST ||
    !env.REVIEW_ROUTER_RESOLUTION_WRITER_FLEET_DIGEST
  )
    return unavailable;
  let url: URL;
  try {
    url = new URL(env.REVIEW_ROUTER_RESOLUTION_WRITER_WITNESS_URL);
    if (
      (url.protocol !== "https:" &&
        !(
          url.protocol === "http:" &&
          ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname)
        )) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return unavailable;
    url.pathname = "/v1/resolution-writer-qualification";
  } catch {
    return unavailable;
  }
  return new SignedResolutionWriterQualification({
    trust: {
      keyId: env.REVIEW_ROUTER_RESOLUTION_WRITER_WITNESS_KEY_ID,
      publicKeyPem: env.REVIEW_ROUTER_RESOLUTION_WRITER_WITNESS_PUBLIC_KEY_PEM,
      maximumAgeMilliseconds: 60_000,
    },
    now: input.now ?? (() => new Date()),
    async readWitness() {
      const response = await (input.fetch ?? fetch)(url, {
        headers: {
          accept: "application/json",
          ...(env.REVIEW_ROUTER_RESOLUTION_WRITER_WITNESS_TOKEN
            ? {
                authorization: `Bearer ${env.REVIEW_ROUTER_RESOLUTION_WRITER_WITNESS_TOKEN}`,
              }
            : {}),
        },
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(2_000),
      });
      if (!response.ok || !response.body)
        throw new Error("resolution_writer_witness_unavailable");
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          size += next.value.byteLength;
          if (size > 65_536)
            throw new Error("resolution_writer_witness_oversized");
          chunks.push(next.value);
        }
        return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
      } finally {
        await reader.cancel().catch(() => {});
      }
    },
    async observeBinding() {
      const rows = await input.prisma.$queryRaw<
        {
          serverIdentity: string;
          databaseIdentity: string;
          databaseName: string;
          databaseComment: string | null;
        }[]
      >(Prisma.sql`SELECT
        (SELECT system_identifier::text FROM pg_catalog.pg_control_system()) AS "serverIdentity",
        oid::text AS "databaseIdentity", datname AS "databaseName",
        pg_catalog.shobj_description(oid, 'pg_database') AS "databaseComment"
        FROM pg_catalog.pg_database WHERE datname = current_database()`);
      const row = rows[0];
      if (rows.length !== 1 || !row)
        throw new Error("resolution_writer_database_unavailable");
      const comment = row.databaseComment
        ? (JSON.parse(row.databaseComment) as {
            recoveryWitnessSha256?: unknown;
          })
        : null;
      if (typeof comment?.recoveryWitnessSha256 !== "string")
        throw new Error("resolution_writer_generation_unavailable");
      return {
        environmentId: env.REVIEW_ROUTER_RESOLUTION_WRITER_ENVIRONMENT_ID!,
        deploymentRevision:
          env.REVIEW_ROUTER_RESOLUTION_WRITER_DEPLOYMENT_REVISION!,
        artifactDigest: env.REVIEW_ROUTER_RESOLUTION_WRITER_ARTIFACT_DIGEST!,
        fleetDigest: env.REVIEW_ROUTER_RESOLUTION_WRITER_FLEET_DIGEST!,
        database: {
          serverIdentity: row.serverIdentity,
          databaseIdentity: row.databaseIdentity,
          databaseName: row.databaseName,
          recoveryWitnessSha256: comment.recoveryWitnessSha256,
        },
      };
    },
  });
}
