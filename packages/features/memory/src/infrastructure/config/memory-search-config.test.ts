import { describe, expect, it } from "vitest";
import {
  MemorySearchConfigurationError,
  parseMemorySearchConfig,
  safeMemorySearchConfigurationErrorCode,
  type InfinityMemorySearchConfig,
} from "./memory-search-config";

const infinityEnv = {
  REVIEW_ROUTER_MEMORY_SEARCH_ENGINE: "infinity",
  REVIEW_ROUTER_MEMORY_INFINITY_BASE_URL: "https://memory.example.test/",
  REVIEW_ROUTER_MEMORY_INFINITY_API_KEY: "private-service-key",
  REVIEW_ROUTER_MEMORY_INFINITY_SPACE_ID: "space_1",
  REVIEW_ROUTER_MEMORY_INFINITY_MEMORY_SCOPE_ID: "scope_1",
  REVIEW_ROUTER_MEMORY_INFINITY_PROJECTION_GENERATION: "projection_1",
  REVIEW_ROUTER_MEMORY_INFINITY_PROFILE_ID: "profile_1",
  REVIEW_ROUTER_MEMORY_INFINITY_CAPABILITY_FINGERPRINT: "a".repeat(64),
  REVIEW_ROUTER_MEMORY_INFINITY_REQUIRED_PROVIDER_LANES: "vector,lexical",
};

function infinityConfig(
  overrides: Readonly<Record<string, string | undefined>> = {},
): InfinityMemorySearchConfig {
  const config = parseMemorySearchConfig({ ...infinityEnv, ...overrides });
  if (config.kind !== "infinity") throw new Error("expected_infinity_config");
  return config;
}

describe("memory search configuration", () => {
  it("uses Prisma unless Infinity is explicitly selected", () => {
    expect(parseMemorySearchConfig({})).toEqual({ kind: "prisma" });
    expect(
      parseMemorySearchConfig({
        ...infinityEnv,
        REVIEW_ROUTER_MEMORY_SEARCH_ENGINE: "prisma",
        REVIEW_ROUTER_MEMORY_INFINITY_BASE_URL: "not-a-url",
      }),
    ).toEqual({ kind: "prisma" });
    expect(() =>
      parseMemorySearchConfig({ REVIEW_ROUTER_MEMORY_SEARCH_ENGINE: "other" }),
    ).toThrow("memory_search_engine_invalid");
  });

  it("normalizes equivalent endpoint/lane configuration without binding the credential", () => {
    const config = infinityConfig();
    const equivalent = infinityConfig({
      REVIEW_ROUTER_MEMORY_INFINITY_BASE_URL:
        " https://MEMORY.EXAMPLE.TEST:443/// ",
      REVIEW_ROUTER_MEMORY_INFINITY_API_KEY: "rotated-private-service-key",
      REVIEW_ROUTER_MEMORY_INFINITY_REQUIRED_PROVIDER_LANES:
        " lexical, vector ",
    });
    expect(config.baseUrl).toBe("https://memory.example.test");
    expect(config.requiredProviderLanes).toEqual(["lexical", "vector"]);
    expect(equivalent.indexIdentity).toBe(config.indexIdentity);
    expect(config.indexIdentity).toMatch(/^infinity:[0-9a-f]{64}$/u);
    expect(config.indexIdentity).not.toContain(config.apiKey);
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.requiredProviderLanes)).toBe(true);
  });

  it.each([
    ["BASE_URL", "https://other.example.test"],
    ["SPACE_ID", "space_2"],
    ["MEMORY_SCOPE_ID", "scope_2"],
    ["PROJECTION_GENERATION", "projection_2"],
    ["PROFILE_ID", "profile_2"],
    ["CAPABILITY_FINGERPRINT", "b".repeat(64)],
    ["REQUIRED_PROVIDER_LANES", "lexical"],
  ])("binds %s to the deployment identity", (name, value) => {
    expect(
      infinityConfig({ [`REVIEW_ROUTER_MEMORY_INFINITY_${name}`]: value })
        .indexIdentity,
    ).not.toBe(infinityConfig().indexIdentity);
  });

  it.each([
    ["BASE_URL", "https://username:secret@memory.example.test"],
    ["BASE_URL", "https://memory.example.test/?token=secret"],
    ["BASE_URL", "https://memory.example.test/#fragment"],
    ["BASE_URL", "file:///tmp/service"],
    ["BASE_URL", "secret-not-a-url"],
    ["API_KEY", "secret\r\nAuthorization: stolen"],
    ["SPACE_ID", ""],
    ["SPACE_ID", "x".repeat(81)],
    ["MEMORY_SCOPE_ID", "\ud800"],
    ["PROJECTION_GENERATION", "x".repeat(257)],
    ["PROFILE_ID", "x".repeat(257)],
    ["SPACE_ID", "😀".repeat(21)],
    ["PROJECTION_GENERATION", "😀".repeat(65)],
    ["CAPABILITY_FINGERPRINT", "A".repeat(64)],
    ["REQUIRED_PROVIDER_LANES", "vector,vector"],
    ["REQUIRED_PROVIDER_LANES", "vector,"],
    ["REQUIRED_PROVIDER_LANES", "one,two,three,four,five"],
  ])(
    "rejects invalid %s without reflecting configured values",
    (name, value) => {
      let failure: unknown;
      try {
        infinityConfig({ [`REVIEW_ROUTER_MEMORY_INFINITY_${name}`]: value });
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(MemorySearchConfigurationError);
      expect((failure as Error).message).toBe(
        `memory_infinity_${name.toLowerCase()}_invalid`,
      );
      expect(safeMemorySearchConfigurationErrorCode(failure)).toBe(
        (failure as Error).message,
      );
      expect((failure as Error).cause).toBeUndefined();
    },
  );

  it("classifies an unsupported engine without exposing its configured value", () => {
    let failure: unknown;
    try {
      parseMemorySearchConfig({
        REVIEW_ROUTER_MEMORY_SEARCH_ENGINE: "private-engine-sentinel",
      });
    } catch (error) {
      failure = error;
    }
    expect(safeMemorySearchConfigurationErrorCode(failure)).toBe(
      "memory_search_engine_invalid",
    );
    expect((failure as Error).cause).toBeUndefined();
  });

  it.each([
    new Error("memory_infinity_api_key_invalid"),
    new Error("private-credential-sentinel"),
    {
      name: "MemorySearchConfigurationError",
      code: "memory_infinity_api_key_invalid",
      message: "memory_infinity_api_key_invalid",
    },
    "memory_search_engine_invalid",
    null,
    Object.assign(
      new MemorySearchConfigurationError("memory_search_engine_invalid"),
      { code: "private-credential-sentinel" },
    ),
  ])("does not classify opaque or spoofed configuration errors", (error) => {
    expect(safeMemorySearchConfigurationErrorCode(error)).toBeNull();
  });

  it("snapshots the diagnostic once and never reflects a private message or cause", () => {
    const failure = Object.assign(
      new MemorySearchConfigurationError("memory_search_engine_invalid"),
      {
        message: "private-config-sentinel",
        cause: new Error("private-credential-sentinel"),
      },
    );
    let reads = 0;
    Object.defineProperty(failure, "code", {
      get: () =>
        ++reads === 1
          ? "memory_search_engine_invalid"
          : "private-code-sentinel",
    });

    expect(safeMemorySearchConfigurationErrorCode(failure)).toBe(
      "memory_search_engine_invalid",
    );
    expect(reads).toBe(1);
  });

  it("requires all Infinity pins even when runtime memory is disabled", () => {
    expect(() =>
      parseMemorySearchConfig({
        REVIEW_ROUTER_MEMORY_SEARCH_ENGINE: "infinity",
        REVIEW_ROUTER_MEMORY_ENABLED: "false",
      }),
    ).toThrow("memory_infinity_base_url_invalid");
  });

  it("counts Unicode scalar values and sorts provider lanes by UTF-8", () => {
    const config = infinityConfig({
      REVIEW_ROUTER_MEMORY_INFINITY_PROFILE_ID: "😀".repeat(256),
      REVIEW_ROUTER_MEMORY_INFINITY_SPACE_ID: "😀".repeat(20),
      REVIEW_ROUTER_MEMORY_INFINITY_REQUIRED_PROVIDER_LANES: "😀,\ue000",
    });
    expect([...config.profileId]).toHaveLength(256);
    expect(Buffer.byteLength(config.spaceId, "utf8")).toBe(80);
    expect(config.requiredProviderLanes).toEqual(["\ue000", "😀"]);
  });
});
