import { describe, expect, it } from "vitest";
import {
  certifiedForkAdmissionUnavailable,
  certifiedForkEventMaxBytes,
  readCertifiedForkInvocation,
} from "../action/certified-fork-lifecycle.js";

function fixture() {
  const repo = { full_name: "base/project", id: 123, private: false };
  return {
    action: "synchronize",
    number: 7,
    repository: { ...repo },
    pull_request: {
      number: 7,
      state: "open",
      draft: false,
      merge_commit_sha: "c".repeat(40),
      base: { sha: "a".repeat(40), repo: { ...repo } },
      head: {
        sha: "b".repeat(40),
        repo: {
          full_name: "source/project",
          id: 456,
          private: false,
          fork: true,
        },
      },
    },
  };
}
function environment(): NodeJS.ProcessEnv {
  return {
    INPUT_MODE: "fork_prompt_only_v2",
    "INPUT_WORKFLOW-SCHEMA-VERSION": "6",
    GITHUB_EVENT_NAME: "pull_request_target",
    GITHUB_REPOSITORY: "base/project",
    GITHUB_REPOSITORY_ID: "123",
    GITHUB_SHA: "d".repeat(40),
  };
}
function parse(event: unknown, env = environment()) {
  return readCertifiedForkInvocation(JSON.stringify(event), env);
}

describe("certified fork event capture", () => {
  it("preserves every field in a detached frozen exact binding before any await", () => {
    const event = fixture();
    const binding = parse(event);
    expect(binding).toEqual({
      sourceRepository: "source/project",
      sourceRepositoryId: "456",
      baseRepository: "base/project",
      baseRepositoryId: "123",
      pullRequestNumber: 7,
      reviewHeadSha: "b".repeat(40),
      baseSha: "a".repeat(40),
      trustDomain: "fork",
    });
    expect(Object.isFrozen(binding)).toBe(true);
    event.pull_request.head.sha = "e".repeat(40);
    event.pull_request.head.repo.id = 999;
    expect(binding.reviewHeadSha).toBe("b".repeat(40));
    expect(binding.sourceRepositoryId).toBe("456");
    expect(() => Object.assign(binding, { baseSha: "e".repeat(40) })).toThrow();
  });

  it.each(["opened", "reopened", "synchronize", "ready_for_review"])(
    "captures eligible current %s events",
    (action) => {
      const event = fixture();
      event.action = action;
      expect(parse(event).pullRequestNumber).toBe(7);
    },
  );

  it("accepts canonical positive safe maximum numeric IDs without losing precision", () => {
    const event = fixture();
    event.pull_request.head.repo.id = Number.MAX_SAFE_INTEGER;
    event.number = event.pull_request.number = Number.MAX_SAFE_INTEGER;
    expect(parse(event)).toMatchObject({
      sourceRepositoryId: String(Number.MAX_SAFE_INTEGER),
      pullRequestNumber: Number.MAX_SAFE_INTEGER,
    });
  });

  it.each([
    ["INPUT_MODE", undefined],
    ["INPUT_MODE", "fork-agentic-sandbox"],
    ["INPUT_MODE", "fork_prompt_only_v2 "],
    ["INPUT_WORKFLOW-SCHEMA-VERSION", undefined],
    ["INPUT_WORKFLOW-SCHEMA-VERSION", "5"],
    ["INPUT_WORKFLOW-SCHEMA-VERSION", "06"],
    ["INPUT_WORKFLOW-SCHEMA-VERSION", "6.0"],
    ["INPUT_WORKFLOW-SCHEMA-VERSION", " 6"],
    ["INPUT_WORKFLOW_SCHEMA_VERSION", "5"],
    ["GITHUB_EVENT_NAME", "pull_request"],
    ["GITHUB_EVENT_NAME", "schedule"],
    ["GITHUB_EVENT_NAME", "workflow_dispatch"],
    ["GITHUB_REPOSITORY", "other/project"],
    ["GITHUB_REPOSITORY", "Base/project"],
    ["GITHUB_REPOSITORY_ID", "456"],
    ["GITHUB_REPOSITORY_ID", "0123"],
    ["GITHUB_REPOSITORY_ID", undefined],
  ])("rejects environment mismatch %s=%s", (key, value) => {
    expect(() =>
      parse(fixture(), { ...environment(), [key!]: value }),
    ).toThrowError(certifiedForkAdmissionUnavailable);
  });

  const mutations: [string, unknown][] = [
    ["action", "closed"],
    ["action", ["synchronize"]],
    ["action", "edited"],
    ["pull_request.draft", true],
    ["pull_request.draft", null],
    ["pull_request.state", "closed"],
    ["number", 8],
    ["pull_request.head.repo", null],
    ["pull_request.head.repo", undefined],
    ["pull_request.head", null],
    ["pull_request.head.repo.fork", false],
    ["pull_request.head.repo.full_name", "base/project"],
    ["pull_request.head.repo.full_name", "BASE/project"],
    ["pull_request.head.repo.id", 123],
    ["repository.id", 999],
    ["repository.full_name", "other/project"],
    ["pull_request.base.repo.id", 999],
    ["pull_request.base.repo.full_name", "other/project"],
  ];
  for (const path of [
    "repository",
    "pull_request.base.repo",
    "pull_request.head.repo",
  ]) {
    for (const id of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "123", null])
      mutations.push([`${path}.id`, id]);
    for (const name of [
      "../project",
      "base/..",
      "base/project/extra",
      "base/$(touch pwn)",
      "base/a\nb",
      "base/a b",
      `base/${"a".repeat(101)}`,
    ])
      mutations.push([`${path}.full_name`, name]);
    for (const value of [true, null, "false"])
      mutations.push([`${path}.private`, value]);
  }
  for (const value of [0, -1, 1.1, "7", Number.MAX_SAFE_INTEGER + 1])
    mutations.push(["pull_request.number", value]);
  for (const path of ["pull_request.base.sha", "pull_request.head.sha"]) {
    for (const value of [
      "main",
      "refs/heads/main",
      "refs/pull/7/merge",
      "abc123",
      "A".repeat(40),
      "c".repeat(40),
      null,
      "$(cat /secret)",
    ])
      mutations.push([path, value]);
  }
  it.each(mutations)("rejects event %s=%s", (path, value) => {
    const event = fixture();
    const keys = path.split(".");
    let target = event as unknown as Record<string, unknown>;
    for (const key of keys.slice(0, -1))
      target = target[key] as Record<string, unknown>;
    target[keys.at(-1)!] = value;
    expect(() => parse(event)).toThrowError(certifiedForkAdmissionUnavailable);
  });

  it("ignores hostile text and caller context instead of granting it authority", () => {
    const event = fixture();
    const hostile = "$(curl attacker)\n::error::secret\n../../AGENTS.md";
    Object.assign(event.pull_request, {
      title: hostile,
      body: hostile,
      binding: { reviewHeadSha: "e".repeat(40) },
    });
    Object.assign(event, { trustedContext: { repositoryId: "999" } });
    expect(
      parse(event, {
        ...environment(),
        INPUT_REVIEW_HEAD_SHA: "e".repeat(40),
        GITHUB_WORKSPACE: hostile,
      }),
    ).toEqual(parse(fixture()));
  });

  it.each([
    "{secret",
    "null",
    "[]",
    " ".repeat(certifiedForkEventMaxBytes + 1),
    JSON.stringify({ body: "💥".repeat(certifiedForkEventMaxBytes / 2) }),
  ])("sanitizes malformed and oversized input %#", (input) => {
    expect(() =>
      readCertifiedForkInvocation(input, environment()),
    ).toThrowError(certifiedForkAdmissionUnavailable);
  });
});
