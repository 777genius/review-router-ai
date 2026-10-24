// Generated from shared/src/review-skills-contract.ts. Do not edit.
import { createHash } from "node:crypto";

/** Published text-only Skills language. Generated consumers must not hand-edit. */
export const reviewSkillsCompanionContract = Object.freeze({
  method: "POST",
  path: "/api/action/v2/skills",
  requestMaxBytes: 1024,
  responseMaxBytes: 256 * 1024,
  schemaVersion: "reviewrouter.review-skills/v1",
} as const);

export const reviewSkillsLimits = Object.freeze({
  nameCharacters: 120,
  descriptionCharacters: 1024,
  instructionsBytes: 32 * 1024,
  referenceBytes: 16 * 1024,
  referencesPerSkill: 8,
  referenceDepth: 4,
  skillsPerRun: 32,
  patternsPerList: 16,
  patternBytes: 256,
  bundleBytes: 256 * 1024,
  treeBytes: 1024 * 1024,
  treeEntries: 4096,
  repositoryIdsPerOperation: 1000,
  skillIdsPerOperation: 100,
  pageSize: 50,
} as const);

export type ReviewSkillScope = Readonly<{
  includePaths: readonly string[];
  excludePaths: readonly string[];
}>;
export type CapturedWebReviewSkill = ReviewSkillScope &
  Readonly<{
    skillId: string;
    revisionId: string;
    sourceWorkspaceId: string;
    name: string;
    description: string;
    instructions: string;
  }>;
export type ReviewSkillGitRoot = ".reviewrouter/skills" | ".agents/skills";
export type CapturedReviewSkills = Readonly<{
  schemaVersion: "reviewrouter.review-skills/v1";
  baseSha: string;
  webSkills: readonly CapturedWebReviewSkill[];
  gitSources: readonly Readonly<{ root: ReviewSkillGitRoot }>[];
  digest: string;
}>;

export const defaultReviewSkillScope: ReviewSkillScope = Object.freeze({
  includePaths: Object.freeze(["**"]),
  excludePaths: Object.freeze([] as string[]),
});

const encoder = new TextEncoder();
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function fail(reason: string): never {
  throw new Error(`review_skills_${reason}`);
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function keys(value: Record<string, unknown>, names: readonly string[]): void {
  if (
    Object.keys(value).length !== names.length ||
    names.some((name) => !Object.hasOwn(value, name))
  )
    fail("unknown_or_missing_fields");
}
function text(value: unknown, characters: number, nonblank: boolean): string {
  if (
    typeof value !== "string" ||
    Array.from(value).length > characters ||
    value.includes("\0") ||
    (nonblank && !value.trim())
  )
    fail("text_invalid");
  // Lone surrogates do not denote UTF-8 text and must not normalize silently.
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) fail("text_invalid");
    } else if (code >= 0xdc00 && code <= 0xdfff) fail("text_invalid");
  }
  return value;
}
function identifier(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(value)
  )
    fail("identifier_invalid");
  return value;
}

function patterns(value: unknown, includes: boolean): readonly string[] {
  if (
    !Array.isArray(value) ||
    value.length > reviewSkillsLimits.patternsPerList ||
    (includes && value.length === 0)
  )
    fail("scope_invalid");
  const result = value.map((item: unknown) => {
    const pattern = text(item, reviewSkillsLimits.patternBytes, true);
    if (
      encoder.encode(pattern).length > reviewSkillsLimits.patternBytes ||
      pattern.startsWith("/") ||
      [...pattern].some((character) => {
        const code = character.charCodeAt(0);
        return code < 32 || code === 127 || "\\:[]{}()!#".includes(character);
      }) ||
      pattern
        .split("/")
        .some(
          (part) =>
            part === "" ||
            part === "." ||
            part === ".." ||
            (part.includes("**") && part !== "**"),
        )
    )
      fail("scope_invalid");
    return pattern;
  });
  if (new Set(result).size !== result.length) fail("scope_duplicate");
  return Object.freeze(result.sort(compare));
}

export function parseReviewSkillScope(value: unknown): ReviewSkillScope {
  if (!record(value)) fail("scope_invalid");
  keys(value, ["includePaths", "excludePaths"]);
  return Object.freeze({
    includePaths: patterns(value.includePaths, true),
    excludePaths: patterns(value.excludePaths, false),
  });
}

/** Deterministic JSON for this published language, independent of locale. */
export function canonicalReviewSkillsJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value))
    return JSON.stringify(value);
  if (Array.isArray(value))
    return `[${value.map(canonicalReviewSkillsJson).join(",")}]`;
  if (record(value))
    return `{${Object.keys(value)
      .sort(compare)
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalReviewSkillsJson(value[key])}`,
      )
      .join(",")}}`;
  return fail("canonical_value_invalid");
}

function normalizePayload(
  value: unknown,
): Omit<CapturedReviewSkills, "digest"> {
  if (!record(value)) fail("capture_invalid");
  keys(value, ["schemaVersion", "baseSha", "webSkills", "gitSources"]);
  if (value.schemaVersion !== reviewSkillsCompanionContract.schemaVersion)
    fail("schema_unsupported");
  if (
    typeof value.baseSha !== "string" ||
    !/^[a-f0-9]{40}$/.test(value.baseSha)
  )
    fail("base_sha_invalid");
  if (
    !Array.isArray(value.webSkills) ||
    value.webSkills.length > reviewSkillsLimits.skillsPerRun
  )
    fail("too_many_skills");
  const seen = new Set<string>();
  const webSkills = value.webSkills
    .map((raw: unknown): CapturedWebReviewSkill => {
      if (!record(raw)) fail("skill_invalid");
      keys(raw, [
        "skillId",
        "revisionId",
        "sourceWorkspaceId",
        "name",
        "description",
        "instructions",
        "includePaths",
        "excludePaths",
      ]);
      const skillId = identifier(raw.skillId);
      if (seen.has(skillId)) fail("duplicate_skill");
      seen.add(skillId);
      const instructions = text(
        raw.instructions,
        reviewSkillsLimits.instructionsBytes,
        true,
      );
      if (
        encoder.encode(instructions).length >
        reviewSkillsLimits.instructionsBytes
      )
        fail("instructions_too_large");
      const scope = parseReviewSkillScope({
        includePaths: raw.includePaths,
        excludePaths: raw.excludePaths,
      });
      return Object.freeze({
        skillId,
        revisionId: identifier(raw.revisionId),
        sourceWorkspaceId: identifier(raw.sourceWorkspaceId),
        name: text(raw.name, reviewSkillsLimits.nameCharacters, true),
        description: text(
          raw.description,
          reviewSkillsLimits.descriptionCharacters,
          false,
        ),
        instructions,
        ...scope,
      });
    })
    .sort((a, b) => compare(a.skillId, b.skillId));
  if (!Array.isArray(value.gitSources) || value.gitSources.length > 2)
    fail("git_sources_invalid");
  const roots = new Set<string>();
  const gitSources = value.gitSources
    .map((raw: unknown) => {
      if (!record(raw)) fail("git_sources_invalid");
      keys(raw, ["root"]);
      if (raw.root !== ".reviewrouter/skills" && raw.root !== ".agents/skills")
        fail("git_sources_invalid");
      if (roots.has(raw.root)) fail("git_source_duplicate");
      roots.add(raw.root);
      return Object.freeze({ root: raw.root });
    })
    .sort((a, b) => compare(a.root, b.root));
  return Object.freeze({
    schemaVersion: reviewSkillsCompanionContract.schemaVersion,
    baseSha: value.baseSha,
    webSkills: Object.freeze(webSkills),
    gitSources: Object.freeze(gitSources),
  });
}

export function createCapturedReviewSkills(
  value: Omit<CapturedReviewSkills, "schemaVersion" | "digest">,
): CapturedReviewSkills {
  const payload = normalizePayload({
    schemaVersion: reviewSkillsCompanionContract.schemaVersion,
    ...value,
  });
  const digest = `sha256:${createHash("sha256")
    .update(canonicalReviewSkillsJson(payload), "utf8")
    .digest("hex")}`;
  const result = Object.freeze({ ...payload, digest });
  if (
    encoder.encode(canonicalReviewSkillsJson(result)).length >
    reviewSkillsLimits.bundleBytes
  )
    fail("capture_too_large");
  return result;
}

export function parseCapturedReviewSkills(
  value: unknown,
): CapturedReviewSkills {
  if (!record(value)) fail("capture_invalid");
  keys(value, [
    "schemaVersion",
    "baseSha",
    "webSkills",
    "gitSources",
    "digest",
  ]);
  if (
    typeof value.digest !== "string" ||
    !/^sha256:[a-f0-9]{64}$/.test(value.digest)
  )
    fail("digest_invalid");
  const { digest, ...payload } = value;
  const normalized = normalizePayload(payload);
  const expected = createCapturedReviewSkills(normalized);
  if (expected.digest !== digest) fail("digest_mismatch");
  return expected;
}
