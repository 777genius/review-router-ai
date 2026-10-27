import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { ReviewSkillScanProfile } from "../domain/catalog-security.js";
import {
  createHttpSkillScanner,
  readSkillScannerConfig,
  skillScannerRevision,
} from "../infrastructure/http/skill-scanner-client.js";

const config = {
  url: "http://skill-scanner:8081",
  token: "fixture-" + "x".repeat(40),
};
function profile(
  changes: Record<string, unknown> = {},
): ReviewSkillScanProfile {
  const value = {
    mode: "static",
    profileId: "static-v1",
    scannerVersion: "2.13.1",
    scannerBuildId: `skillspector@${skillScannerRevision}:${"a".repeat(64)}`,
    policyVersion: "skill-import-v1",
    model: null,
    maxDurationMs: 90000,
    maxCalls: 0,
    maxInputBytes: 65536,
    maxOutputTokens: 0,
    ...changes,
  };
  const canonical = Object.fromEntries(
    Object.entries(value).sort(([a], [b]) => a.localeCompare(b, "en")),
  );
  return {
    ...value,
    fingerprint:
      "sha256:" +
      createHash("sha256").update(JSON.stringify(canonical)).digest("hex"),
  } as ReviewSkillScanProfile;
}
function scanInput() {
  return {
    jobId: "job-1",
    attemptId: "attempt-1",
    canonicalText: "fixed text",
    contentDigest: "sha256:" + "b".repeat(64),
    profile: profile(),
    deadlineAt: new Date(Date.now() + 90000).toISOString(),
  };
}
function envelope(input = scanInput()) {
  return {
    schemaVersion: 1,
    jobId: input.jobId,
    attemptId: input.attemptId,
    contentDigest: input.contentDigest,
    profileFingerprint: input.profile.fingerprint,
    scannerBuildId: input.profile.scannerBuildId,
    executionFinished: true,
    report: { native: "application normalizes this report" },
  };
}
const response = (value: unknown) => new Response(JSON.stringify(value));

describe("private scanner HTTP boundary", () => {
  it("requires an explicitly enabled worker and a bounded operator destination/token", () => {
    const env = {
      REVIEW_ROUTER_SKILL_SCAN_WORKER_ENABLED: "true",
      REVIEW_ROUTER_SKILL_SCANNER_URL: config.url,
      REVIEW_ROUTER_SKILL_SCANNER_TOKEN: config.token,
    };
    expect(readSkillScannerConfig(env)).toEqual(config);
    expect(
      readSkillScannerConfig({
        ...env,
        REVIEW_ROUTER_SKILL_SCAN_WORKER_ENABLED: "false",
      }),
    ).toBeNull();
    for (const url of [
      "http://169.254.169.254",
      "https://user:secret@example.com",
      "https://example.com/scans",
      "https://example.com?token=x",
      "file:///etc/passwd",
    ]) {
      expect(
        readSkillScannerConfig({
          ...env,
          REVIEW_ROUTER_SKILL_SCANNER_URL: url,
        }),
      ).toBeNull();
    }
    for (const token of [
      "short",
      "x".repeat(257),
      "x".repeat(32) + "\n",
      "x".repeat(32) + "é",
    ]) {
      expect(
        readSkillScannerConfig({
          ...env,
          REVIEW_ROUTER_SKILL_SCANNER_TOKEN: token,
        }),
      ).toBeNull();
    }
  });

  it("accepts only verified bounded profiles and never follows service redirects", async () => {
    const profiles = [
      profile(),
      profile({
        mode: "ai",
        profileId: "ai-v1:1234",
        model: "fixture-model",
        maxDurationMs: 180000,
        maxCalls: 4,
        maxInputBytes: 131072,
        maxOutputTokens: 2048,
      }),
    ];
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response({ schemaVersion: 1, profiles }));
    expect(
      await createHttpSkillScanner(config, fetcher).loadProfiles(),
    ).toEqual(profiles);
    expect(fetcher).toHaveBeenCalledWith(
      `${config.url}/v1/profiles`,
      expect.objectContaining({
        redirect: "error",
        signal: expect.any(AbortSignal),
        headers: expect.objectContaining({
          authorization: `Bearer ${config.token}`,
        }),
      }),
    );
  });

  it.each([
    { scannerVersion: "other" },
    { scannerBuildId: "unverified-build" },
    { policyVersion: "other" },
    { maxDurationMs: 90001 },
    { maxCalls: 1 },
    { maxInputBytes: 65537 },
    { maxOutputTokens: 1 },
    { unexpected: true },
    { model: "not-static" },
    { mode: "other" },
  ])(
    "rejects an incompatible profile even with a consistent fingerprint: %j",
    async (change) => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          response({ schemaVersion: 1, profiles: [profile(change)] }),
        );
      await expect(
        createHttpSkillScanner(config, fetcher).loadProfiles(),
      ).rejects.toThrow("skill_scanner_unavailable");
    },
  );

  it("rejects corrupted identities, duplicate modes and an AI-only service", async () => {
    const ai = profile({
      mode: "ai",
      model: "fixture-model",
      maxCalls: 4,
      maxOutputTokens: 2048,
    });
    for (const profiles of [
      [{ ...profile(), fingerprint: "sha256:" + "0".repeat(64) }],
      [profile(), profile()],
      [ai],
    ]) {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue(response({ schemaVersion: 1, profiles }));
      await expect(
        createHttpSkillScanner(config, fetcher).loadProfiles(),
      ).rejects.toThrow("skill_scanner_unavailable");
    }
  });

  it("sends exact canonical content and accepts only the matching finished execution", async () => {
    const input = scanInput();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response(envelope(input)));
    expect(await createHttpSkillScanner(config, fetcher).scan(input)).toEqual({
      jobId: input.jobId,
      attemptId: input.attemptId,
      contentDigest: input.contentDigest,
      profileFingerprint: input.profile.fingerprint,
      scannerBuildId: input.profile.scannerBuildId,
      executionFinished: true,
      report: envelope(input).report,
    });
    const init = fetcher.mock.calls[0]![1]!;
    expect(init.redirect).toBe("error");
    expect(JSON.parse(String(init.body))).toEqual({
      jobId: input.jobId,
      attemptId: input.attemptId,
      profile: "static",
      content: input.canonicalText,
      contentDigest: input.contentDigest,
      profileFingerprint: input.profile.fingerprint,
      deadlineAt: input.deadlineAt,
    });
  });

  it.each([
    "jobId",
    "attemptId",
    "contentDigest",
    "profileFingerprint",
    "scannerBuildId",
    "executionFinished",
    "schemaVersion",
  ])(
    "does not release execution authority after a mismatched %s",
    async (field) => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue(response({ ...envelope(), [field]: "wrong" }));
      await expect(
        createHttpSkillScanner(config, fetcher).scan(scanInput()),
      ).rejects.toThrow("skill_scanner_unavailable");
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );

  it("cancels oversized streaming responses before parsing them", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(16385));
      },
      cancel,
    });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(body));
    await expect(
      createHttpSkillScanner(config, fetcher).loadProfiles(),
    ).rejects.toThrow("skill_scanner_unavailable");
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("neither launches expired executions nor retries transport failures", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("reply lost"));
    const scanner = createHttpSkillScanner(config, fetcher);
    await expect(
      scanner.scan({ ...scanInput(), deadlineAt: "2001-01-01T00:00:00Z" }),
    ).rejects.toThrow("skill_scanner_unavailable");
    expect(fetcher).not.toHaveBeenCalled();
    await expect(scanner.scan(scanInput())).rejects.toThrow("reply lost");
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
