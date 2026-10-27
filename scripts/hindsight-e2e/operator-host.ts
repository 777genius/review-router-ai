import assert from "node:assert/strict";

export type DockerExecutorInspection = {
  Id: string;
  Image: string;
  Config: { Env: string[]; Cmd: string[]; Labels: Record<string, string> };
  HostConfig: { RestartPolicy: { Name: string } };
  State: { Running: boolean; Pid: number; Status: string; ExitCode: number };
};
export function assertExecutorPhase(
  records: readonly DockerExecutorInspection[],
  restartIds: readonly string[],
  phase: "initial" | "stopped" | "restarted",
): void {
  for (const record of records) {
    assert.equal(
      record.HostConfig.RestartPolicy.Name,
      "no",
      "Docker automatic restart must be disabled before the deployment fence",
    );
    assert(
      !Object.keys(record.Config.Labels ?? {}).some((key) =>
        /^(com\.docker\.(compose|swarm)|io\.kubernetes|io\.containerd|com\.dokku)/.test(
          key,
        ),
      ),
      "An external reconciler is unsupported by the standalone deployment fence",
    );
    assert(
      ["api", "worker"].includes(
        record.Config.Labels?.["io.reviewrouter.hindsight.role"] ?? "",
      ),
      "Every executor role must be explicit",
    );
    if (
      phase === "stopped" ||
      (phase === "restarted" && !restartIds.includes(record.Id))
    ) {
      assert(
        record.State.Running === false &&
          record.State.Pid === 0 &&
          record.State.Status === "exited",
        "A supposedly stopped executor restarted during cleanup",
      );
    } else if (phase === "restarted")
      assert(
        record.State.Running &&
          record.State.Pid > 0 &&
          record.State.Status === "running",
        "Expected restarted executor is not running",
      );
  }
}

/** SQL proof has exactly one source of endpoint identity: the inspected API DSN. */
export function nativeSqlObserverArguments(
  apiDsn: string,
  imageDigest: string,
  statement: string,
): string[] {
  const dsn = new URL(apiDsn);
  assert(dsn.protocol === "postgresql:" || dsn.protocol === "postgres:");
  assert(["127.0.0.1", "localhost"].includes(dsn.hostname));
  assert(/^sha256:[a-f0-9]{64}$/.test(imageDigest));
  dsn.searchParams.set("application_name", "rr-native-cleanup-read-observer");
  const python =
    'import asyncio,os,sys; from hindsight_api.config import get_config; import asyncpg\nasync def main():\n c=await asyncpg.connect(os.environ["HINDSIGHT_API_DATABASE_URL"],timeout=10)\n try:\n  await c.execute("SET default_transaction_read_only=on")\n  print(await c.fetchval(sys.argv[1]))\n finally: await c.close()\nasyncio.run(main())';
  return [
    "run",
    "--rm",
    "--network",
    "host",
    "--env",
    `HINDSIGHT_API_DATABASE_URL=${dsn}`,
    imageDigest,
    "python",
    "-c",
    python,
    statement,
  ];
}
