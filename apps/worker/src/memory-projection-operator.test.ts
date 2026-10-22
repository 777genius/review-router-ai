import { describe, expect, it } from "vitest";
import { createMemorySearchRuntime } from "@reviewrouter/features-memory/composition";
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
    ).toBe("memory_projection_operator_failed");
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

  it.each([
    {
      env: { REVIEW_ROUTER_MEMORY_SEARCH_ENGINE: "unknown-engine-sentinel" },
      expectedCode: "memory_search_engine_invalid",
    },
    {
      env: {
        REVIEW_ROUTER_MEMORY_SEARCH_ENGINE: "infinity",
        REVIEW_ROUTER_MEMORY_INFINITY_BASE_URL: "https://memory.example.test",
        REVIEW_ROUTER_MEMORY_INFINITY_API_KEY: "private credential sentinel",
      },
      expectedCode: "memory_infinity_api_key_invalid",
    },
  ])(
    "preserves feature-owned configuration diagnostics through composition",
    async ({ env, expectedCode }) => {
      // Configuration must fail before composition accesses this borrowed DB.
      const prisma = {} as Parameters<
        typeof createMemorySearchRuntime
      >[0]["prisma"];
      const failure: unknown = await createMemorySearchRuntime({
        prisma,
        env,
      }).catch((error: unknown) => error);
      expect(safeMemoryProjectionOperatorError(failure)).toBe(expectedCode);
      expect((failure as Error).cause).toBeUndefined();
    },
  );
});
