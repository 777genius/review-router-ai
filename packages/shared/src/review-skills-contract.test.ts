import { describe, expect, it } from "vitest";
import {
  canonicalReviewSkillsJson,
  createCapturedReviewSkills,
  parseCapturedReviewSkills,
  parseReviewSkillScope,
  defaultReviewSkillScope,
} from "./review-skills-contract";
import { parseReviewAgentProfiles } from "./review-agent-profile";

const baseSha = "a".repeat(40);
const skill = {
  skillId: "skill-1",
  revisionId: "revision-1",
  sourceWorkspaceId: "workspace-1",
  name: "Безопасность",
  description: "Проверять границы доступа",
  instructions: "Проверь, что пользователь может читать только свои данные.",
  ...defaultReviewSkillScope,
};
const emptyGolden = {
  schemaVersion: "reviewrouter.review-skills/v1",
  baseSha,
  webSkills: [],
  gitSources: [],
  // Independently computed with UTF-8 sorted-key JSON and SHA-256.
  digest:
    "sha256:59c835834c2552d265f3ad2b2e2210ca578ca9ebd0be74e8f59a038717c53496",
} as const;

describe("published Review Skills language", () => {
  it("matches the independent empty golden, preserving explicit captured emptiness", () => {
    expect(
      createCapturedReviewSkills({ baseSha, webSkills: [], gitSources: [] }),
    ).toEqual(emptyGolden);
    expect(parseCapturedReviewSkills(emptyGolden)).toEqual(emptyGolden);
    expect(() => parseCapturedReviewSkills(null)).toThrow();
  });
  it("freezes a normalized set and never aliases mutable author input", () => {
    const input = { ...skill, includePaths: ["src/**", ".github/*"] };
    const result = createCapturedReviewSkills({
      baseSha,
      webSkills: [input],
      gitSources: [],
    });
    input.instructions = "Changed";
    input.includePaths.push("other/**");
    expect(result.webSkills[0]?.instructions).toBe(skill.instructions);
    expect(result.webSkills[0]?.includePaths).toEqual([".github/*", "src/**"]);
    expect(Object.isFrozen(result.webSkills[0])).toBe(true);
    expect(Object.isFrozen(result.webSkills[0]?.includePaths)).toBe(true);
    expect(
      parseCapturedReviewSkills(JSON.parse(canonicalReviewSkillsJson(result))),
    ).toEqual(result);
  });
  it("changes identity with revision, content, scope and Git source selection", () => {
    const capture = (change = {}) =>
      createCapturedReviewSkills({
        baseSha,
        webSkills: [{ ...skill, ...change }],
        gitSources: [],
      });
    const original = capture().digest;
    for (const change of [
      { revisionId: "revision-2" },
      { instructions: "Проверь race conditions." },
      { includePaths: ["src/**"] },
      { excludePaths: ["src/test/**"] },
    ])
      expect(capture(change).digest).not.toBe(original);
    expect(
      createCapturedReviewSkills({
        baseSha,
        webSkills: [skill],
        gitSources: [{ root: ".agents/skills" }],
      }).digest,
    ).not.toBe(original);
  });
  it("rejects tampering, unknown keys, duplicate identities and invalid capabilities", () => {
    const captured = createCapturedReviewSkills({
      baseSha,
      webSkills: [skill],
      gitSources: [],
    });
    expect(() =>
      parseCapturedReviewSkills({
        ...captured,
        webSkills: [{ ...skill, instructions: "tampered" }],
      }),
    ).toThrow("digest_mismatch");
    expect(() =>
      parseCapturedReviewSkills({ ...captured, execute: true }),
    ).toThrow();
    expect(() =>
      createCapturedReviewSkills({
        baseSha,
        webSkills: [skill, skill],
        gitSources: [],
      }),
    ).toThrow("duplicate_skill");
    expect(() =>
      createCapturedReviewSkills({
        baseSha,
        webSkills: [],
        gitSources: [{ root: ".agents/skills" }, { root: ".agents/skills" }],
      }),
    ).toThrow("duplicate");
  });
  it("enforces UTF-8 and aggregate limits rather than truncating", () => {
    expect(() =>
      createCapturedReviewSkills({
        baseSha,
        webSkills: [{ ...skill, instructions: "Я".repeat(20000) }],
        gitSources: [],
      }),
    ).toThrow("instructions_too_large");
    expect(() =>
      createCapturedReviewSkills({
        baseSha,
        webSkills: [{ ...skill, instructions: "\ud800" }],
        gitSources: [],
      }),
    ).toThrow("text_invalid");
    const skills = Array.from({ length: 9 }, (_, n) => ({
      ...skill,
      skillId: `skill-${n}`,
      instructions: "x".repeat(32000),
    }));
    expect(() =>
      createCapturedReviewSkills({
        baseSha,
        webSkills: skills,
        gitSources: [],
      }),
    ).toThrow("capture_too_large");
  });
  it.each([
    "/src/**",
    "../src",
    "a/../b",
    "a//b",
    "src\\\\a",
    "!a",
    "#a",
    "{a,b}",
    "[ab]",
    "@(a)",
    "a**b",
    "**.ts",
    "C:/src",
    "src/\u0000.ts",
    "src/\u001f.ts",
    "src/\u007f.ts",
  ])("rejects out-of-dialect scope %s", (pattern) => {
    expect(() =>
      parseReviewSkillScope({ includePaths: [pattern], excludePaths: [] }),
    ).toThrow();
  });
  it("accepts the explicit anchored POSIX subset including dot paths", () => {
    expect(
      parseReviewSkillScope({
        includePaths: ["src/**/*.ts", ".github/*", "a?.ts"],
        excludePaths: ["**/test/**"],
      }),
    ).toEqual({
      includePaths: [".github/*", "a?.ts", "src/**/*.ts"],
      excludePaths: ["**/test/**"],
    });
  });
});

const legacy = {
  profileRef: "ocr-managed-v2",
  agentKind: "ocr",
  binarySha256: "b".repeat(64),
  packageVersion: "1.13.1-rr.3",
  modelTransports: ["account_gateway"],
  contextGateway: false,
  cancellation: true,
};
describe("registered Skills capability", () => {
  it("preserves all seven historical keys and their canonical bytes", () => {
    expect(
      canonicalReviewSkillsJson(parseReviewAgentProfiles([legacy])[0]),
    ).toBe(canonicalReviewSkillsJson(legacy));
    expect(Object.keys(parseReviewAgentProfiles([legacy])[0]!)).toHaveLength(7);
  });
  it("preserves only explicitly supported capability 1", () => {
    expect(
      parseReviewAgentProfiles([{ ...legacy, reviewSkillsVersion: 1 }])[0]
        ?.reviewSkillsVersion,
    ).toBe(1);
    for (const value of [null, undefined, 0, 2, "1"])
      expect(() =>
        parseReviewAgentProfiles([{ ...legacy, reviewSkillsVersion: value }]),
      ).toThrow();
  });
});
