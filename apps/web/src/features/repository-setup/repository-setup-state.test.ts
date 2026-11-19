import { describe, expect, it } from "vitest";
import {
  compareRepositorySetupRows,
  readRepositorySetupFilter,
  repositoryMatchesSetupFilter,
  repositorySetupState,
  showsFirstRunGuide,
  summarizeRepositorySetup,
  writeRepositorySetupFilter,
  type RepositorySetupFilter,
  type RepositorySetupStateFacts,
} from "./repository-setup-state";

const untouched: RepositorySetupStateFacts = {
  available: true,
  step: "setup_pr",
  healthDanger: false,
  healthBlocksReview: true,
  setupNeedsAttention: false,
  gatewayAuthorization: "none",
  gatewayAccountsRead: true,
  setupStarted: false,
};

describe("repositorySetupState", () => {
  it.each<readonly [string, Partial<RepositorySetupStateFacts>, string]>([
    ["an untouched repository is neutral", {}, "not_set_up"],
    [
      "an unselected, archived or GitLab repository leaves the counts",
      { available: false, healthDanger: true },
      "unavailable",
    ],
    [
      "an open setup PR is in progress",
      { step: "merge_setup_pr", setupStarted: true },
      "setting_up",
    ],
    [
      "a merged workflow waiting for its credential is in progress",
      { step: "provider", setupStarted: true },
      "setting_up",
    ],
    [
      "a workflow update is in progress, also after a provider change",
      { step: "setup_pr", setupStarted: true },
      "setting_up",
    ],
    [
      "a closed setup PR needs attention",
      { setupNeedsAttention: true, setupStarted: true },
      "attention",
    ],
    [
      "a failed setup PR (danger health) needs attention",
      { healthDanger: true, setupStarted: true },
      "attention",
    ],
    [
      "a paused or blocked Gateway authorization needs attention",
      {
        step: "setup_pr",
        gatewayAuthorization: "blocked",
        setupStarted: true,
      },
      "attention",
    ],
    [
      "an authorized Gateway repository whose account fails needs attention",
      {
        step: "provider",
        gatewayAuthorization: "ready",
        healthBlocksReview: true,
        setupStarted: true,
      },
      "attention",
    ],
    [
      "a failed account read does not paint a working repository red",
      {
        step: "provider",
        gatewayAuthorization: "ready",
        gatewayAccountsRead: false,
        setupStarted: true,
      },
      "setting_up",
    ],
    [
      "a ready step is ready",
      { step: "ready", healthBlocksReview: false, setupStarted: true },
      "ready",
    ],
    [
      "a ready step whose health still blocks reviews is not ready",
      { step: "ready", healthBlocksReview: true, setupStarted: true },
      "setting_up",
    ],
  ])("%s", (_name, overrides, expected) => {
    expect(repositorySetupState({ ...untouched, ...overrides })).toBe(expected);
  });
});

describe("repository setup filter", () => {
  it.each<readonly [RepositorySetupFilter, string]>([
    ["all", ""],
    ["private", "visibility=private"],
    ["public", "visibility=public"],
    ["attention", "setup=attention"],
    ["setting_up", "setup=setting_up"],
    ["ready", "setup=ready"],
    ["not_set_up", "setup=not_set_up"],
  ])("%s round-trips through the URL", (filter, query) => {
    const params = new URLSearchParams("setup=ready&visibility=public&q=x");
    writeRepositorySetupFilter(params, filter);
    params.delete("q");
    expect(params.toString()).toBe(query);
    expect(readRepositorySetupFilter((name) => params.get(name))).toBe(filter);
  });

  it("reads retired or unknown values as all", () => {
    const params = new URLSearchParams("setup=needed");
    expect(readRepositorySetupFilter((name) => params.get(name))).toBe("all");
  });

  it("matches states and visibility", () => {
    const row = { visibility: "private", state: "not_set_up" } as const;
    expect(repositoryMatchesSetupFilter(row, "not_set_up")).toBe(true);
    expect(repositoryMatchesSetupFilter(row, "setting_up")).toBe(false);
    expect(repositoryMatchesSetupFilter(row, "private")).toBe(true);
    expect(repositoryMatchesSetupFilter(row, "public")).toBe(false);
    expect(repositoryMatchesSetupFilter(row, "all")).toBe(true);
  });
});

describe("repository order and counts", () => {
  it("puts repositories that need you first and untouched ones last", () => {
    const rows = [
      { state: "not_set_up", fullName: "acme/a" },
      { state: "unavailable", fullName: "acme/b" },
      { state: "ready", fullName: "acme/c" },
      { state: "setting_up", fullName: "acme/e" },
      { state: "attention", fullName: "acme/f" },
      { state: "setting_up", fullName: "acme/d" },
    ] as const;
    expect(
      [...rows].sort(compareRepositorySetupRows).map((row) => row.fullName),
    ).toEqual(["acme/f", "acme/d", "acme/e", "acme/c", "acme/a", "acme/b"]);
  });

  it("counts only repositories that can be set up", () => {
    expect(
      summarizeRepositorySetup([
        "ready",
        "not_set_up",
        "not_set_up",
        "unavailable",
      ]),
    ).toMatchObject({
      ready: 1,
      notSetUp: 2,
      settingUp: 0,
      attention: 0,
      tone: "success",
    });
    expect(summarizeRepositorySetup(["not_set_up"])).toMatchObject({
      tone: "neutral",
      label: "No repositories set up yet",
    });
    expect(summarizeRepositorySetup(["ready", "attention"])).toMatchObject({
      tone: "danger",
      label: "1 need attention",
    });
  });

  it("shows the first-run guide until any repository starts its setup", () => {
    expect(showsFirstRunGuide(["not_set_up", "unavailable"])).toBe(true);
    expect(showsFirstRunGuide(["not_set_up", "setting_up"])).toBe(false);
    expect(showsFirstRunGuide(["unavailable"])).toBe(false);
    expect(showsFirstRunGuide([])).toBe(false);
  });
});
