import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { copiedInputCustody, finishProof } from "./lint-format-proof.ts";

function withProof(run: (output: string, subject: string) => void): void {
  const output = mkdtempSync(
    join(realpathSync(tmpdir()), "lint-proof-control-"),
  );
  const subject = join(output, "TEST");
  mkdirSync(subject);
  try {
    run(output, subject);
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
}

test("copied input custody detects source mutation and absence while allowing generated fixtures", () => {
  withProof((_output, subject) => {
    const path = join(subject, "source.ts");
    const original = "export const value = 1;\n";
    writeFileSync(path, original);
    const expected = {
      "source.ts": createHash("sha256").update(original).digest("hex"),
    };
    expect(copiedInputCustody(subject, expected)).toEqual({
      hashes: expected,
      matches: true,
    });
    mkdirSync(join(subject, "output"));
    writeFileSync(join(subject, "output", "mutable.ts"), "generated fixture\n");
    expect(copiedInputCustody(subject, expected).matches).toBe(true);
    writeFileSync(path, "export const value = 2;\n");
    const changed = copiedInputCustody(subject, expected);
    expect(changed.matches).toBe(false);
    expect(changed.hashes["source.ts"]).not.toBe(expected["source.ts"]);
    rmSync(path);
    expect(() => copiedInputCustody(subject, expected)).toThrow(/ENOENT/);
  });
});

test("a successful receipt is written only after the owned TEST copy is removed", () => {
  withProof((output, subject) => {
    writeFileSync(join(subject, "fixture.txt"), "owned fixture\n");
    const receipt = finishProof(
      output,
      { testScope: "synthetic proof-boundary control" },
      [],
      (owned) => {
        expect(owned).toBe(subject);
        expect(existsSync(join(output, "receipt.json"))).toBe(false);
        rmSync(owned, { recursive: true, force: true });
      },
    );
    expect(existsSync(subject)).toBe(false);
    expect(receipt.status).toBe("passed");
    expect(receipt.cleanup.completed).toBe(true);
    expect(
      JSON.parse(readFileSync(join(output, "receipt.json"), "utf8")),
    ).toEqual(receipt);
  });
});

test("cleanup failure retains prior execution evidence and writes an explicitly failed receipt", () => {
  withProof((output, subject) => {
    const stages = [{ name: "synthetic execution", status: 1 }];
    const receipt = finishProof(
      output,
      { stages },
      [{ phase: "execution", message: "original failure" }],
      () => {
        expect(existsSync(join(output, "receipt.json"))).toBe(false);
        throw new Error("synthetic cleanup I/O failure");
      },
    );
    expect(receipt.status).toBe("failed");
    expect(receipt.cleanup.completed).toBe(false);
    expect(receipt.failures).toEqual([
      { phase: "execution", message: "original failure" },
      { phase: "cleanup", message: "synthetic cleanup I/O failure" },
    ]);
    const saved = JSON.parse(
      readFileSync(join(output, "receipt.json"), "utf8"),
    );
    expect(saved.status).toBe("failed");
    expect(saved.stages).toEqual(stages);
    expect(existsSync(subject)).toBe(true);
  });
});

test("a cleanup callback that leaves owned files cannot produce a passing receipt", () => {
  withProof((output, subject) => {
    const receipt = finishProof(output, {}, [], () => {});
    expect(receipt.status).toBe("failed");
    expect(receipt.cleanup.completed).toBe(false);
    expect(receipt.failures[0]?.message).toContain(
      "Owned TEST cleanup left the subject behind",
    );
    expect(existsSync(subject)).toBe(true);
  });
});
