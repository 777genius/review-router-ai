import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { repositorySetupGate, type AgentInstallStatus } from "./install.ts";
import {
  defaultActionCommit,
  renderEnvironment,
  sha256,
} from "./install-config.ts";

const root = resolve(import.meta.dirname, "../..");
const entrypoint = join(root, "deploy/self-hosted/install.ts");
const supportedHost = process.platform === "linux" && process.arch === "x64";

function invoke(...args: string[]) {
  const result = spawnSync(process.execPath, [entrypoint, ...args], {
    cwd: root,
    encoding: "utf8",
    input: "",
    timeout: 10_000,
    env: { ...process.env, CI: "true" },
  });
  assert.equal(result.error, undefined);
  return result;
}

test("agent status works without a TTY and without starting Docker or GitHub", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rr-agent-status-"));
  try {
    const result = invoke("--status", "--directory", directory);
    assert.equal(result.status, 0, result.stderr);
    const status: AgentInstallStatus = JSON.parse(result.stdout);
    assert.equal(status.schemaVersion, 1);
    assert.equal(status.state, "not_started");
    assert.equal(status.phase, "configuration");
    assert.equal(result.stdout.trim().split("\n").length, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test(
  "default installer returns one machine-readable input request, with private durable status and no credentials",
  { skip: !supportedHost },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "rr-agent-input-"));
    try {
      const result = invoke(
        "--directory",
        directory,
        "--repo",
        "example/review-target",
      );
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout.trim().split("\n").length, 1);
      const status: AgentInstallStatus = JSON.parse(result.stdout);
      assert.equal(status.state, "input_required");
      assert.equal(status.phase, "configuration");
      assert.deepEqual(status.next?.requiredOptions, ["--web-url"]);
      assert.deepEqual(status.next?.resume?.slice(0, 4), [
        "bash",
        "scripts/install-self-hosted.sh",
        "--directory",
        directory,
      ]);
      assert.deepEqual(status.next?.resume?.slice(-2), [
        "--repo",
        "example/review-target",
      ]);
      const stateFile = join(directory, "agent-status.json");
      assert.equal((await stat(stateFile)).mode & 0o777, 0o600);
      assert.deepEqual(JSON.parse(await readFile(stateFile, "utf8")), status);
      const resume = invoke("--status", "--directory", directory);
      assert.equal(resume.status, 0, resume.stderr);
      assert.deepEqual(JSON.parse(resume.stdout), status);
      await assert.rejects(
        readFile(join(directory, "installation.json"), "utf8"),
        { code: "ENOENT" },
      );
      await assert.rejects(readFile(join(directory, ".env"), "utf8"), {
        code: "ENOENT",
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test(
  "explicit human mode still requires a terminal, but agent mode does not",
  { skip: !supportedHost },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "rr-agent-interactive-"));
    try {
      const result = invoke("--directory", directory, "--interactive");
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /Interactive setup requires a terminal/);
      assert.equal(result.stdout.trim(), "");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test("status refuses to follow a private state symlink", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rr-agent-symlink-"));
  try {
    const target = join(directory, "other-state");
    await symlink(target, join(directory, "agent-status.json"));
    const result = invoke("--status", "--directory", directory);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /symlinks are not accepted/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test(
  "agent resume includes explicit first-run choices without losing security defaults",
  { skip: !supportedHost },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "rr-agent-options-"));
    try {
      const result = invoke(
        "--directory",
        directory,
        "--repo",
        "example/target",
        "--api-url",
        "https://api.review.example.com",
        "--app-name",
        "ReviewRouter Example",
        "--app-profile",
        "/private/initial-app.env",
        "--github-org",
        "example",
        "--without-memory",
        "--review-only",
        "--external-proxy",
      );
      assert.equal(result.status, 0, result.stderr);
      const status: AgentInstallStatus = JSON.parse(result.stdout);
      assert.equal(status.state, "input_required");
      const argv = status.next?.resume ?? [];
      for (const flag of [
        "--repo",
        "--api-url",
        "--app-name",
        "--app-profile",
        "--github-org",
        "--without-memory",
        "--review-only",
        "--external-proxy",
      ])
        assert(argv.includes(flag), `Missing resume option: ${flag}`);
      assert.equal(
        argv[argv.indexOf("--app-name") + 1],
        "ReviewRouter Example",
      );
      assert.equal(
        argv[argv.indexOf("--api-url") + 1],
        "https://api.review.example.com",
      );
      assert.equal(
        argv[argv.indexOf("--app-profile") + 1],
        "/private/initial-app.env",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test("malformed or forged saved agent status is rejected before any deployment work", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rr-agent-invalid-"));
  const statePath = join(directory, "agent-status.json");
  try {
    for (const payload of [
      "null",
      "[]",
      '"unexpected"',
      '{"schemaVersion":1,"state":"verified","phase":"first_review","message":"fake"}',
      '{"schemaVersion":1,"state":"running","phase":"test","message":"x","next":{"action":"run","argv":"rm -rf"}}',
    ]) {
      await writeFile(statePath, payload, { mode: 0o600 });
      const result = invoke("--status", "--directory", directory);
      assert.notEqual(result.status, 0, payload);
      assert.match(result.stderr, /Saved agent (?:status|next action)/);
      assert.equal(await readFile(statePath, "utf8"), payload);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test(
  "agent reuses a live-ready fixture across four non-TTY invocations without rebuilding",
  { skip: !supportedHost },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "rr-resume-"));
    const bin = join(directory, "bin");
    const sourceCommit = "a".repeat(40);
    const releaseId = "self-hosted-action-" + defaultActionCommit;
    const credential = "fixture-only-credential";
    const dockerLog = join(directory, "docker.log");
    try {
      await mkdir(bin, { mode: 0o700 });
      const git = join(bin, "git");
      await writeFile(
        git,
        [
          "#!/bin/sh",
          'case "$*" in',
          '  "rev-parse HEAD") echo "' + sourceCommit + '" ;;',
          '  "status --porcelain --untracked-files=normal") exit 0 ;;',
          "  *) exit 17 ;;",
          "esac",
          "",
        ].join("\n"),
      );
      await chmod(git, 0o700);
      const installed = JSON.stringify({
        producerReleaseId: releaseId,
        actionCommitSha: defaultActionCommit,
        protocolLimitsProfileId: "limits-fixture",
        operationalSloProfileId: "slo-fixture",
        state: "registered",
        revokedAt: null,
      });
      const docker = join(bin, "docker");
      await writeFile(
        docker,
        [
          "#!/bin/sh",
          'echo "$*" >> "$RR_TEST_DOCKER_LOG"',
          'case "$*" in',
          '  "context inspect "*) echo "unix:///var/run/docker.sock" ;;',
          '  "info "*) echo "27.0.0" ;;',
          '  "compose version --short") echo "v2.39.0" ;;',
          '  *"ps --format json worker") echo \'{"State":"running"}\' ;;',
          '  *"review-v2:admin env-preflight") if [ "$RR_TEST_FAIL_PREFLIGHT" = "1" ]; then exit 18; fi; echo \'{"ready":true}\' ;;',
          '  *"review-v2:admin release inspect "*) echo \'' +
            installed +
            "' ;;",
          '  *"review-v2:admin status --repo "*) echo \'{"authority":{"mode":"v2_active"},"emergencyControls":{"global":{"stopped":false},"repository":{"stopped":false}}}\' ;;',
          '  *"up -d --no-build "*) exit 0 ;;',
          '  *) echo "Unexpected docker command: $*" >&2; exit 17 ;;',
          "esac",
          "",
        ].join("\n"),
      );
      await chmod(docker, 0o700);
      const fetchPatch = join(directory, "mock-health.mjs");
      await writeFile(
        fetchPatch,
        "globalThis.fetch = async () => ({ status: 200, body: { cancel: async () => undefined } });\n",
      );
      const settings = {
        version: 1,
        sourceCommit,
        actionCommit: defaultActionCommit,
        installationId: "1234567890abcdef",
        webUrl: "https://review.example.com",
        apiUrl: "https://api.review.example.com",
        proxy: "caddy",
        memory: "disabled",
        permissionProfile: "provisioning",
      };
      const environment = renderEnvironment({
        REVIEW_ROUTER_WEB_URL: settings.webUrl,
        REVIEW_ROUTER_API_URL: settings.apiUrl,
        REVIEW_ROUTER_CODEX_ROTATING_ACTION_REF:
          "777genius/review-router@" + defaultActionCommit,
        REVIEW_ROUTER_REVIEW_V2_OPERATOR_CREDENTIAL_SHA256: sha256(credential),
        REVIEW_ROUTER_REVIEW_V2_PRODUCER_RELEASE_ATTESTATIONS_JSON:
          JSON.stringify([
            {
              producerReleaseId: releaseId,
              actionCommitSha: defaultActionCommit,
              protocolLimitsProfileId: "limits-fixture",
              operationalSloProfileId: "slo-fixture",
            },
          ]),
        GITHUB_APP_SLUG: "reviewrouter-fixture",
      });
      const marker = JSON.stringify({
        sourceCommit,
        actionCommit: defaultActionCommit,
        webUrl: settings.webUrl,
        checkedAt: "2026-11-07T00:00:00Z",
      });
      for (const [name, value] of [
        ["installation.json", JSON.stringify(settings)],
        ["operator-credential", credential],
        [".env", environment],
        ["server-ready.json", marker],
      ] as const) {
        await writeFile(join(directory, name), value, { mode: 0o600 });
      }
      const invokeResumed = (...args: string[]) => {
        return spawnSync(
          process.execPath,
          [entrypoint, "--directory", directory, ...args],
          {
            cwd: root,
            encoding: "utf8",
            timeout: 10_000,
            input: "",
            env: {
              ...process.env,
              CI: "true",
              PATH: bin + ":" + process.env.PATH,
              RR_TEST_DOCKER_LOG: dockerLog,
              RR_TEST_FAIL_PREFLIGHT: args.includes(
                "--repository-setup-complete",
              )
                ? "1"
                : "0",
              NODE_OPTIONS:
                (process.env.NODE_OPTIONS ?? "") + " --import=" + fetchPatch,
            },
          },
        );
      };
      const cases: { args: string[]; state: string }[] = [
        { args: [], state: "server_ready" },
        {
          args: ["--repo", "example/review-target"],
          state: "repository_setup_required",
        },
        {
          args: [
            "--repo",
            "example/review-target",
            "--repository-setup-complete",
          ],
          state: "failed",
        },
        { args: [], state: "verification_required" },
      ];
      for (const { args, state } of cases) {
        const result = invokeResumed(...args);
        assert.equal(result.error, undefined);
        assert.equal(result.status, state === "failed" ? 1 : 0, result.stderr);
        assert.equal(JSON.parse(result.stdout).state, state);
        assert.equal(result.stdout.trim().split("\n").length, 1);
      }
      assert.equal(
        await readFile(join(directory, "operator-credential"), "utf8"),
        credential,
      );
      assert.equal(
        await readFile(join(directory, "server-ready.json"), "utf8"),
        marker,
      );
      assert.equal(
        await readFile(
          join(directory, "repository-setup-acknowledged"),
          "utf8",
        ),
        "example/review-target",
      );
      const calls = await readFile(dockerLog, "utf8");
      assert(!calls.includes("--build --wait"));
      assert(!calls.includes("release register"));
      assert(!calls.includes("up -d --wait postgres"));
      assert(calls.includes("release inspect"));
      await rm(join(directory, "operator-credential"));
      const unsafeResume = invokeResumed();
      assert.notEqual(unsafeResume.status, 0);
      assert.match(
        unsafeResume.stderr,
        /Ready marker exists but saved credentials are missing/,
      );
      await assert.rejects(
        readFile(join(directory, "operator-credential"), "utf8"),
        { code: "ENOENT" },
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test("repository approval is scoped, explicit and survives an interrupted activation", () => {
  const repository = "example/review-target";
  const waiting: AgentInstallStatus = {
    schemaVersion: 1,
    state: "repository_setup_required",
    phase: "repository",
    message: "Approve the workflow",
    repository,
  };
  const failed: AgentInstallStatus = {
    ...waiting,
    state: "failed",
  };
  assert.equal(
    repositorySetupGate(undefined, waiting, repository, false),
    "request_approval",
  );
  assert.equal(
    repositorySetupGate(undefined, waiting, repository, true),
    "save_acknowledgment",
  );
  assert.equal(
    repositorySetupGate(repository, failed, repository, false),
    "approved",
  );
  assert.equal(
    repositorySetupGate(repository, failed, repository, true),
    "approved",
  );
  assert.throws(
    () => repositorySetupGate(undefined, failed, repository, true),
    /First receive repository_setup_required/,
  );
  assert.throws(
    () => repositorySetupGate(undefined, waiting, "another/repo", true),
    /First receive repository_setup_required/,
  );
  assert.throws(
    () => repositorySetupGate(repository, waiting, "another/repo", false),
    /refuse to widen/,
  );
});
