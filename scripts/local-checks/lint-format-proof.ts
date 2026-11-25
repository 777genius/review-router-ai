import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { assertNoSymlinks, writeFixture } from "./lint-format-test-support.ts";

export interface ProofFailure {
  readonly phase: string;
  readonly message: string;
}

interface ProofReceipt extends Readonly<Record<string, unknown>> {
  readonly status: "passed" | "failed";
  readonly failures: readonly ProofFailure[];
  readonly cleanup: { readonly subject: string; readonly completed: boolean };
}

export function digest(bytes: string | Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function recordProofFailure(
  failures: ProofFailure[],
  phase: string,
  error: unknown,
): void {
  failures.push({
    phase,
    message: error instanceof Error ? error.message : String(error),
  });
}

/** Checks only copied source/config/witness paths; generated fixtures remain mutable. */
export function copiedInputCustody(
  subject: string,
  expected: Readonly<Record<string, string>>,
): { readonly hashes: Record<string, string>; readonly matches: boolean } {
  const hashes = Object.fromEntries(
    Object.keys(expected).map((path) => {
      const absolute = join(subject, path);
      assertNoSymlinks(absolute);
      assert.ok(
        lstatSync(absolute).isFile(),
        `Expected a copied input file: ${path}`,
      );
      return [path, digest(readFileSync(absolute))];
    }),
  );
  return { hashes, matches: isDeepStrictEqual(hashes, expected) };
}

function removeOwnedSubject(subject: string): void {
  rmSync(subject, { recursive: true, force: true });
}

/** Writes the final result after cleanup, preserving both execution and cleanup failures. */
export function finishProof(
  output: string,
  report: Readonly<Record<string, unknown>>,
  failures: readonly ProofFailure[],
  cleanup: (subject: string) => void = removeOwnedSubject,
): ProofReceipt {
  const subject = join(output, "TEST");
  const errors = [...failures];
  let completed = false;
  try {
    cleanup(subject);
    assert.equal(
      existsSync(subject),
      false,
      "Owned TEST cleanup left the subject behind",
    );
    completed = true;
  } catch (error) {
    recordProofFailure(errors, "cleanup", error);
  }
  const receipt: ProofReceipt = {
    ...report,
    status: errors.length === 0 ? "passed" : "failed",
    failure: errors[0]?.message,
    failures: errors,
    cleanup: { subject, completed },
  };
  writeFixture(output, "receipt.json", JSON.stringify(receipt, null, 2) + "\n");
  return receipt;
}
