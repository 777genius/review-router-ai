import assert from "node:assert/strict";
import { assertExecutorPhase } from "./operator-host.ts";
import type { CleanupExecutorInspection } from "./cleanup-runtime-profile.ts";

/** Complete standalone-host census capacity; never truncate or filter the host list. */
export const CLEANUP_HOST_CONTAINER_LIMIT = 1024;

/** Optional operator attestation from the existing bootstrap state and pinned PG image. */
export interface CleanupPostgresInfrastructure {
  /** Exact containers.postgres ID in the existing bootstrap state. */
  readonly containerId: string;
  /** Docker image ID resolved from the qualified immutable bootstrap postgresImage pin. */
  readonly imageDigest: string;
  /** Bootstrap postgresPort; must also match the inspected API's loopback DSN. */
  readonly port: number;
}
export type CleanupHostInspection = CleanupExecutorInspection & {
  readonly Config: CleanupExecutorInspection["Config"] & {
    readonly Entrypoint?: readonly string[];
  };
  readonly HostConfig: CleanupExecutorInspection["HostConfig"] & {
    readonly NetworkMode?: string;
  };
  readonly State: CleanupExecutorInspection["State"] & {
    readonly StartedAt?: string;
    readonly Restarting?: boolean;
    readonly Paused?: boolean;
    readonly Dead?: boolean;
  };
  readonly RestartCount?: number;
};
type InventoryPlan = {
  readonly deploymentLabel: string;
  readonly imageDigest: string;
  readonly apiContainerId: string;
  readonly executorContainerIds: readonly string[];
  readonly restartContainerIds: readonly string[];
  readonly postgresInfrastructure?: CleanupPostgresInfrastructure;
};
const databaseIdentity = (record: CleanupHostInspection) => {
  const setting = record.Config.Env?.find((value) =>
    value.startsWith("HINDSIGHT_API_DATABASE_URL="),
  );
  if (!setting) return undefined;
  const url = new URL(setting.slice("HINDSIGHT_API_DATABASE_URL=".length));
  return `${url.hostname}:${url.port || 5432}${url.pathname}`;
};

/** Retains the complete native image/database census; an attested PG is never an executor. */
export class CleanupHostInventory {
  private postgresLifetime: string | undefined;
  private readonly plan: InventoryPlan;
  constructor(plan: InventoryPlan) {
    this.plan = plan;
  }

  inspect(
    records: readonly CleanupHostInspection[],
    phase: "initial" | "stopped" | "restarted",
    cleanupContainerId?: string,
  ): CleanupExecutorInspection[] {
    assert(
      records.length <= CLEANUP_HOST_CONTAINER_LIMIT,
      "Standalone host inventory exceeds the bounded inspection profile",
    );
    const { plan } = this;
    const api = records.find((record) => record.Id === plan.apiContainerId);
    assert(api);
    const expectedDatabase = databaseIdentity(api);
    assert(expectedDatabase);
    const [labelKey, labelValue] = plan.deploymentLabel.split("=");
    const postgres = plan.postgresInfrastructure;
    if (postgres) {
      assert(
        /^[a-f0-9]{64}$/.test(postgres.containerId) &&
          /^sha256:[a-f0-9]{64}$/.test(postgres.imageDigest) &&
          postgres.imageDigest !== plan.imageDigest &&
          Number.isInteger(postgres.port) &&
          postgres.port > 0 &&
          postgres.port <= 65535 &&
          !plan.executorContainerIds.includes(postgres.containerId) &&
          !plan.restartContainerIds.includes(postgres.containerId) &&
          postgres.containerId !== plan.apiContainerId &&
          postgres.containerId !== cleanupContainerId,
        "PostgreSQL infrastructure binding is invalid or includes a native executor",
      );
      const record = records.find(
        (record) => record.Id === postgres.containerId,
      );
      assert(
        record,
        "Attested PostgreSQL container is absent from the complete host census",
      );
      assert(
        record.Image === postgres.imageDigest &&
          record.Config.Labels?.[labelKey!] === labelValue &&
          !Object.hasOwn(
            record.Config.Labels,
            "io.reviewrouter.hindsight.role",
          ) &&
          record.Config.Env.includes("PG_MAJOR=17") &&
          !record.Config.Env.some((setting) =>
            /^HINDSIGHT[^=]*=/.test(setting),
          ) &&
          record.HostConfig.NetworkMode === "host" &&
          record.HostConfig.RestartPolicy.Name === "no" &&
          !Object.keys(record.Config.Labels).some((key) =>
            /^(com\.docker\.(compose|swarm)|io\.kubernetes|io\.containerd|com\.dokku)/.test(
              key,
            ),
          ),
        "Attested PostgreSQL image, role, environment or standalone host profile differs",
      );
      assert.deepEqual(
        record.Config.Entrypoint,
        ["docker-entrypoint.sh"],
        "Attested PostgreSQL entrypoint differs",
      );
      assert.deepEqual(
        record.Config.Cmd,
        [
          "-p",
          String(postgres.port),
          "-c",
          "listen_addresses=127.0.0.1",
          "-c",
          "log_statement=none",
          "-c",
          "log_min_messages=panic",
          "-c",
          "log_min_error_statement=panic",
          "-c",
          "log_error_verbosity=terse",
          "-c",
          "log_parameter_max_length=0",
          "-c",
          "log_parameter_max_length_on_error=0",
        ],
        "Attested PostgreSQL command differs from the bootstrap PG17 profile",
      );
      const databaseSetting = api.Config.Env.find((value) =>
        value.startsWith("HINDSIGHT_API_DATABASE_URL="),
      )!;
      const database = new URL(
        databaseSetting.slice("HINDSIGHT_API_DATABASE_URL=".length),
      );
      assert(
        ["postgres:", "postgresql:"].includes(database.protocol) &&
          ["127.0.0.1", "localhost"].includes(database.hostname) &&
          Number(database.port || "5432") === postgres.port,
        "Attested PostgreSQL port differs from the actual loopback API database endpoint",
      );
      assert(
        record.State.Running &&
          record.State.Pid > 0 &&
          record.State.Status === "running" &&
          record.State.Restarting === false &&
          record.State.Paused === false &&
          record.State.Dead === false &&
          typeof record.State.StartedAt === "string" &&
          Number.isFinite(Date.parse(record.State.StartedAt)) &&
          Number.isSafeInteger(record.RestartCount) &&
          record.RestartCount! >= 0,
        "Attested PostgreSQL must remain continuously running during cleanup",
      );
      const lifetime = JSON.stringify([
        record.Id,
        record.Image,
        record.State.Pid,
        record.State.StartedAt,
        record.RestartCount,
      ]);
      if (phase === "initial") {
        assert.equal(
          this.postgresLifetime,
          undefined,
          "PostgreSQL lifetime may be captured only once",
        );
        this.postgresLifetime = lifetime;
      } else
        assert.equal(
          lifetime,
          this.postgresLifetime,
          "Attested PostgreSQL restarted or changed during cleanup",
        );
    }
    const native: CleanupExecutorInspection[] = [];
    for (const record of records) {
      if (record.Id === cleanupContainerId) {
        assert(
          record.Image === plan.imageDigest &&
            record.Config.Cmd?.[0] === "hindsight-api",
          "Private cleanup observer identity drift",
        );
        continue;
      }
      if (record.Id === postgres?.containerId) continue;
      if (
        record.Config.Labels?.[labelKey!] === labelValue ||
        record.Image === plan.imageDigest ||
        databaseIdentity(record) === expectedDatabase
      ) {
        assert.equal(
          record.Config.Labels?.[labelKey!],
          labelValue,
          "An executor sharing this image/database is outside the authoritative deployment label",
        );
        assert(
          ["api", "worker"].includes(
            record.Config.Labels?.["io.reviewrouter.hindsight.role"] ?? "",
          ),
        );
        native.push(record);
      }
    }
    assert.deepEqual(
      native.map((record) => record.Id).sort(),
      [...plan.executorContainerIds].sort(),
      "Executor inventory drift; no receipt can be issued",
    );
    assert(
      native.every((record) => record.Image === plan.imageDigest),
      "An unqualified old executor image remains",
    );
    assertExecutorPhase(native, plan.restartContainerIds, phase);
    return native;
  }
}
