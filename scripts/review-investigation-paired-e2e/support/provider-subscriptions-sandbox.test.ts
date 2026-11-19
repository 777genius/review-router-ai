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
    expect(requireSandboxProof(JSON.stringify(proof))).toEqual({
      ...proof,
      backend: "legacy-landlock",
    });
    for (const key of Object.keys(proof).filter((key) => key !== "contract")) {
      expect(() =>
        requireSandboxProof(JSON.stringify({ ...proof, [key]: false })),
      ).toThrow("codex_read_only_sandbox_unqualified");
    }
    for (const raw of [
      "",
      "null",
      "{}",
      "[]",
      "startup failed with a private diagnostic",
      JSON.stringify({ ...proof, contract: "unknown" }),
      JSON.stringify({ ...proof, extra: true }),
      JSON.stringify(proof) + JSON.stringify(proof),
      " ".repeat(4097) + JSON.stringify(proof),
    ]) {
      expect(() => requireSandboxProof(raw)).toThrow(
        "codex_read_only_sandbox_unqualified",
      );
    }
  });

  for (const fixture of [
    { name: "empty successful exit", body: "exit 0" },
    {
      name: "nonzero exit with a forged complete proof",
      body: `printf '%s' '${JSON.stringify(proof)}'; exit 9`,
    },
    {
      name: "startup refusal",
      body: "printf '%s' 'private child startup diagnostic' >&2; exit 101",
    },
    { name: "timeout", body: "exec sleep 10" },
    {
      name: "descendant holding output after parent exit",
      body: "sleep 10 & exit 0",
    },
    {
      name: "actual child without filesystem or network enforcement",
      body: 'while [ "$1" != "--" ]; do shift; done\nshift\n"$@" > "$0.receipt"\nstatus=$?\ncat "$0.receipt"\nexit "$status"',
      executesProbe: true,
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
        await expect(
          qualifyReadonlySandbox({
            binary,
            workspace,
            outsideRoot: root,
            environment: process.env,
          }),
        ).rejects.toThrow("codex_read_only_sandbox_unqualified");
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
