import { describe, expect, it } from "vitest";
import {
  parseMemoryProjectionOperatorArgs,
  safeMemoryProjectionOperatorError,
} from "./memory-projection-operator";

describe("memory projection operator", () => {
  it("parses bounded resumable backfill and requires an explicit stopped-writers assertion for drain", () => {
    expect(parseMemoryProjectionOperatorArgs(["--help"])).toEqual({
      kind: "help",
    });
    expect(parseMemoryProjectionOperatorArgs(["backfill"])).toEqual({
      kind: "backfill",
    });
    expect(
      parseMemoryProjectionOperatorArgs([
        "backfill",
        "--limit",
        "500",
        "--after",
        "mem_last",
      ]),
    ).toEqual({ kind: "backfill", limit: 500, afterId: "mem_last" });
    expect(
      parseMemoryProjectionOperatorArgs([
        "drain",
        "--writers-stopped",
        "--limit",
        "100",
      ]),
    ).toEqual({ kind: "drain", writersStopped: true, limit: 100 });
    expect(() => parseMemoryProjectionOperatorArgs(["drain"])).toThrow(
      "memory_projection_writers_stopped_required",
    );
  });

  it.each([
    [],
    ["unknown-command"],
    ["backfill", "--limit", "0"],
    ["backfill", "--limit", "501"],
    ["backfill", "--limit", "1.5"],
    ["backfill", "--limit", "1e2"],
    ["backfill", "--limit", "1", "--limit", "2"],
    ["backfill", "--limit"],
    ["backfill", "--after", "--limit"],
    ["backfill", "--after", "mem id"],
    ["backfill", "--after", "x".repeat(257)],
    ["backfill", "--writers-stopped"],
    ["drain", "--writers-stopped", "--limit", "101"],
    ["drain", "--writers-stopped", "--writers-stopped"],
    ["drain", "--writers-stopped", "--after", "mem_last"],
    ["drain", "--writers-stopped", "provider-key-sentinel"],
  ])(
    "rejects ambiguous or unbounded arguments without reflecting them: %j",
    (...args) => {
      expect(() => parseMemoryProjectionOperatorArgs(args)).toThrow(
        "memory_projection_operator_arguments_invalid",
      );
    },
  );

  it("exposes only fixed operational codes and redacts opaque provider/database failures", () => {
    expect(
      safeMemoryProjectionOperatorError(
        new Error("memory_index_identity_conflict"),
      ),
    ).toBe("memory_index_identity_conflict");
    expect(
      safeMemoryProjectionOperatorError(
        new Error("memory_infinity_api_key_invalid"),
      ),
    ).toBe("memory_infinity_api_key_invalid");
    expect(
      safeMemoryProjectionOperatorError(
        new Error("credential-sentinel private-memory-body"),
      ),
    ).toBe("memory_projection_operator_failed");
    expect(
      safeMemoryProjectionOperatorError({
        message: "credential-sentinel",
      }),
    ).toBe("memory_projection_operator_failed");
  });
});
