import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  qualifyReadonlySandbox,
  requireSandboxProof,
  SandboxQualificationError,
} from "./provider-subscriptions-sandbox";

const proof = {
  contract: "codex-read-only-sandbox/v1",
  childExecuted: true,
  readSucceeded: true,
  workspaceWriteDenied: true,
  outsideWriteDenied: true,
  loopbackTCPDenied: true,
  noNewPrivileges: true,
};

describe("joined read-only sandbox proof", () => {
  it("accepts only the complete closed proof from a successful child", () => {
    const raw = JSON.stringify(proof);
    for (const value of [
      raw,
      raw + "\n",
      raw + " ".repeat(4096 - Buffer.byteLength(raw)),
    ])
      expect(requireSandboxProof(value)).toEqual({
        ...proof,
        backend: "bubblewrap",
      });
  });

  it("reports only closed proof categories without echoing private output", () => {
    const failures: { raw: string; reason: string }[] = [
      { raw: "", reason: "proof_empty" },
      { raw: " \t\r\n", reason: "proof_empty" },
      { raw: " ".repeat(4097), reason: "proof_size" },
      { raw: "€".repeat(1366), reason: "proof_size" },
      {
        raw: "startup failed with a private diagnostic",
        reason: "proof_json",
      },
      {
        raw: JSON.stringify(proof) + JSON.stringify(proof),
        reason: "proof_json",
      },
      { raw: "{}", reason: "proof_fields" },
      {
        raw: JSON.stringify({ ...proof, extra: "private diagnostic" }),
        reason: "proof_fields",
      },
      {
        raw: JSON.stringify({
          ...proof,
          readSucceeded: undefined,
          extra: true,
        }),
        reason: "proof_fields",
      },
      {
        raw: JSON.stringify({ ...proof, contract: "private unknown contract" }),
        reason: "proof_contract",
      },
    ];
    for (const raw of ["null", "true", "1", '"private scalar"', "[]"])
      failures.push({ raw, reason: "proof_shape" });
    for (const [field, reason] of [
      ["childExecuted", "proof_child_executed"],
      ["readSucceeded", "proof_read_succeeded"],
      ["workspaceWriteDenied", "proof_workspace_write_denied"],
      ["outsideWriteDenied", "proof_outside_write_denied"],
      ["loopbackTCPDenied", "proof_loopback_tcp_denied"],
      ["noNewPrivileges", "proof_no_new_privileges"],
    ] as const) {
      for (const value of [false, 0, 1, "true", null])
        failures.push({
          raw: JSON.stringify({ ...proof, [field]: value }),
          reason,
        });
    }
    for (const { raw, reason } of failures) {
      let failure: unknown;
      try {
        requireSandboxProof(raw);
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(SandboxQualificationError);
      expect(failure).toMatchObject({
        message: "codex_read_only_sandbox_unqualified",
        reason,
      });
      expect(JSON.stringify(failure)).toBe(JSON.stringify({ reason }));
    }
  });

  for (const fixture of [
    { name: "empty successful exit", body: "exit 0", reason: "proof_empty" },
    {
      name: "successful exit with a forged failed network control",
      body: `printf '%s' '${JSON.stringify({ ...proof, loopbackTCPDenied: false })}'; exit 0`,
      reason: "proof_loopback_tcp_denied",
    },
    {
      name: "nonzero exit with a forged complete proof",
      body: `printf '%s' '${JSON.stringify(proof)}'; exit 9`,
      reason: "child_nonzero_exit",
    },
    {
      name: "startup refusal",
      body: "printf '%s' 'private child startup diagnostic' >&2; exit 101",
      reason: "child_panic_exit",
    },
    {
      name: "unsupported CLI arguments",
      body: "printf '%s' 'private child arguments' >&2; exit 2",
      reason: "child_usage_exit",
    },
    {
      name: "managed policy refused by the legacy backend",
      body: "printf '%s' 'permission profiles requiring direct runtime enforcement are incompatible with --use-legacy-landlock; private configuration' >&2; exit 101",
      reason: "policy_refused",
    },
    {
      name: "bubblewrap namespace creation refused",
      body: "printf '%s' 'bwrap: Creating new namespace failed: private system diagnostic' >&2; exit 1",
      reason: "child_namespace_refused",
    },
    {
      name: "bubblewrap namespace permission refused",
      body: "printf '%s' 'bwrap: No permissions to create a new namespace, private system diagnostic' >&2; exit 1",
      reason: "child_namespace_refused",
    },
    {
      name: "unknown namespace diagnostic",
      body: "printf '%s' 'private child: Creating new namespace failed: private path' >&2; exit 1",
      reason: "child_nonzero_exit",
    },
    {
      name: "namespace diagnostic with an unknown suffix",
      body: "printf '%s' 'bwrap: Creating new namespace failed-looking custom diagnostic' >&2; exit 1",
      reason: "child_nonzero_exit",
    },
    {
      name: "bounded child diagnostics",
      body: "head -c 8193 /dev/zero >&2; exit 101",
      reason: "child_output_limit",
    },
    { name: "timeout", body: "exec sleep 10", reason: "child_timeout" },
    {
      name: "descendant holding output after parent exit",
      body: "sleep 10 & exit 0",
      reason: "child_timeout",
    },
    {
      name: "actual child without filesystem or network enforcement",
      body: 'while [ "$1" != "--" ]; do shift; done\nshift\n"$@" > "$0.receipt"\nstatus=$?\ncat "$0.receipt"\nexit "$status"',
      executesProbe: true,
      reason: "child_nonzero_exit",
    },
    {
      name: "actual child with a blackholed process.stdout",
      body: 'while [ "$1" != "--" ]; do shift; done\nshift\nprobe_node="$1"\nshift\n"$probe_node" --import "$0.stdout.mjs" "$@" > "$0.receipt"\nstatus=$?\ncat "$0.receipt"\nexit "$status"',
      executesProbe: true,
      blackholeStdout: true,
      reason: "child_nonzero_exit",
    },
  ]) {
    it(`fails closed for ${fixture.name} and cleans its disposable controls`, async () => {
      const root = await mkdtemp(
        path.join(tmpdir(), "joined-sandbox-negative-"),
      );
      const workspace = path.join(root, "workspace");
      const binary = path.join(root, "negative-cli");
      try {
        await mkdir(workspace);
        await writeFile(binary, "#!/bin/sh\n" + fixture.body + "\n");
        await chmod(binary, 0o700);
        if ("blackholeStdout" in fixture)
          await writeFile(
            binary + ".stdout.mjs",
            'import { Writable } from "node:stream";\n' +
              'Object.defineProperty(process, "stdout", { value: new Writable({ write(_chunk, _encoding, callback) { callback(); } }) });\n' +
              'process.stdout.write("discarded-stream-control");\n',
          );
        const error = await qualifyReadonlySandbox({
          binary,
          workspace,
          outsideRoot: root,
          environment: process.env,
        }).then(
          () => undefined,
          (failure: unknown) => failure,
        );
        expect(error).toBeInstanceOf(SandboxQualificationError);
        expect(error).toMatchObject({
          message: "codex_read_only_sandbox_unqualified",
          reason: fixture.reason,
        });
        expect(JSON.stringify(error)).toBe(
          JSON.stringify({ reason: fixture.reason }),
        );
        expect(await readFile(binary, "utf8")).toBe(
          "#!/bin/sh\n" + fixture.body + "\n",
        );
        if ("executesProbe" in fixture) {
          expect(
            JSON.parse(await readFile(binary + ".receipt", "utf8")),
          ).toMatchObject({
            childExecuted: true,
            readSucceeded: true,
            workspaceWriteDenied: false,
            outsideWriteDenied: false,
            loopbackTCPDenied: false,
          });
          await rm(binary + ".receipt");
        }
        if ("blackholeStdout" in fixture) await rm(binary + ".stdout.mjs");
        expect(await readdir(workspace)).toEqual([]);
        expect((await readdir(root)).sort()).toEqual([
          "negative-cli",
          "workspace",
        ]);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }, 10_000);
  }
});
