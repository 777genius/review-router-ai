import { createHash } from "node:crypto";
import type {
  ReviewSkillScanExecutorPort,
  ReviewSkillScanProfile,
} from "../../application/catalog-contracts.js";

export const skillScannerRevision = "f3b25697d76256998ca9d42c198d256258d4c035";
export type SkillScannerConfig = Readonly<{ url: string; token: string }>;
const unavailable = () => new Error("skill_scanner_unavailable");
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Operator configuration only. Browser requests never choose this destination. */
export function readSkillScannerConfig(
  env: Readonly<Record<string, string | undefined>>,
): SkillScannerConfig | null {
  if (env.REVIEW_ROUTER_SKILL_SCAN_WORKER_ENABLED !== "true") return null;
  const origin = env.REVIEW_ROUTER_SKILL_SCANNER_URL;
  const token = env.REVIEW_ROUTER_SKILL_SCANNER_TOKEN;
  if (!origin || !token || !/^[\x21-\x7e]{32,256}$/u.test(token)) return null;
  try {
    const url = new URL(origin);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !["", "/"].includes(url.pathname) ||
      (url.protocol !== "https:" &&
        !(
          url.protocol === "http:" &&
          ["127.0.0.1", "[::1]", "localhost", "skill-scanner"].includes(
            url.hostname,
          )
        ))
    )
      return null;
    return { url: url.origin, token };
  } catch {
    return null;
  }
}

async function boundedJson(
  response: Response,
  maximum: number,
): Promise<unknown> {
  if (
    !response.ok ||
    !response.body ||
    Number(response.headers.get("content-length") ?? 0) > maximum
  )
    throw unavailable();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) throw unavailable();
      chunks.push(value);
    }
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
    );
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

function profile(value: unknown): ReviewSkillScanProfile {
  if (!record(value)) throw unavailable();
  const keys = [
    "mode",
    "profileId",
    "fingerprint",
    "scannerVersion",
    "scannerBuildId",
    "policyVersion",
    "model",
    "maxDurationMs",
    "maxCalls",
    "maxInputBytes",
    "maxOutputTokens",
  ];
  if (
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !(key in value))
  )
    throw unavailable();
  const ai = value.mode === "ai";
  if (
    (!ai && value.mode !== "static") ||
    value.scannerVersion !== "2.13.1" ||
    value.policyVersion !== "skill-import-v1" ||
    typeof value.scannerBuildId !== "string" ||
    !new RegExp(
      `^skillspector@${skillScannerRevision}:[a-f0-9]{64}$`,
      "u",
    ).test(value.scannerBuildId) ||
    typeof value.profileId !== "string" ||
    !/^[a-z0-9:-]{1,80}$/u.test(value.profileId) ||
    typeof value.fingerprint !== "string" ||
    !/^sha256:[a-f0-9]{64}$/u.test(value.fingerprint) ||
    (ai
      ? typeof value.model !== "string" ||
        !/^[A-Za-z0-9_.:/-]{1,128}$/u.test(value.model)
      : value.model !== null)
  )
    throw unavailable();
  const bounds = {
    maxDurationMs: ai ? 180000 : 90000,
    maxCalls: ai ? 4 : 0,
    maxInputBytes: ai ? 131072 : 65536,
    maxOutputTokens: ai ? 2048 : 0,
  };
  for (const [key, maximum] of Object.entries(bounds)) {
    const n = value[key];
    if (
      typeof n !== "number" ||
      !Number.isSafeInteger(n) ||
      n > maximum ||
      (maximum === 0 ? n !== 0 : n < 1)
    )
      throw unavailable();
  }
  const identity = Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== "fingerprint")
      .sort(([a], [b]) => a.localeCompare(b, "en")),
  );
  if (
    value.fingerprint !==
    `sha256:${createHash("sha256").update(JSON.stringify(identity)).digest("hex")}`
  )
    throw unavailable();
  return value as unknown as ReviewSkillScanProfile;
}

export function createHttpSkillScanner(
  config: SkillScannerConfig,
  fetcher: typeof fetch = fetch,
): ReviewSkillScanExecutorPort & {
  loadProfiles(): Promise<readonly ReviewSkillScanProfile[]>;
} {
  const headers = {
    authorization: `Bearer ${config.token}`,
    "content-type": "application/json",
  };
  return {
    async loadProfiles() {
      const body = await boundedJson(
        await fetcher(`${config.url}/v1/profiles`, {
          headers,
          redirect: "error",
          signal: AbortSignal.timeout(3000),
        }),
        16384,
      );
      if (
        !record(body) ||
        body.schemaVersion !== 1 ||
        !Array.isArray(body.profiles) ||
        body.profiles.length < 1 ||
        body.profiles.length > 2
      )
        throw unavailable();
      const profiles = body.profiles.map(profile);
      if (
        new Set(profiles.map((p) => p.mode)).size !== profiles.length ||
        !profiles.some((p) => p.mode === "static")
      )
        throw unavailable();
      return profiles;
    },
    async scan(input) {
      const remaining = Math.min(
        Date.parse(input.deadlineAt) - Date.now(),
        input.profile.maxDurationMs,
      );
      if (!Number.isFinite(remaining) || remaining <= 0) throw unavailable();
      const body = await boundedJson(
        await fetcher(`${config.url}/v1/scans`, {
          method: "POST",
          headers,
          redirect: "error",
          signal: AbortSignal.timeout(Math.ceil(remaining + 10000)),
          body: JSON.stringify({
            jobId: input.jobId,
            attemptId: input.attemptId,
            profile: input.profile.mode,
            content: input.canonicalText,
            contentDigest: input.contentDigest,
            profileFingerprint: input.profile.fingerprint,
            deadlineAt: input.deadlineAt,
          }),
        }),
        1024 * 1024,
      );
      if (
        !record(body) ||
        body.schemaVersion !== 1 ||
        body.executionFinished !== true ||
        body.jobId !== input.jobId ||
        body.attemptId !== input.attemptId ||
        body.contentDigest !== input.contentDigest ||
        body.profileFingerprint !== input.profile.fingerprint ||
        body.scannerBuildId !== input.profile.scannerBuildId ||
        !("report" in body)
      )
        throw unavailable();
      return {
        jobId: input.jobId,
        attemptId: input.attemptId,
        contentDigest: input.contentDigest,
        profileFingerprint: input.profile.fingerprint,
        scannerBuildId: input.profile.scannerBuildId,
        report: body.report,
        executionFinished: true,
      };
    },
  };
}
