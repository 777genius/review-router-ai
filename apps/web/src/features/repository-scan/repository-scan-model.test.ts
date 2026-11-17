import { describe, expect, it } from "vitest";
import {
  ageRepositoryScan,
  isNewerRepositoryScan,
  repositoryScanBackoffMs,
  repositoryScanListRefreshKey,
  repositoryScanPollIntervalMs,
  repositoryScanStateOf,
  summarizeRepositoryScan,
  type RepositoryScanInstallation,
  type RepositoryScanSnapshot,
} from "./repository-scan-model";

const now = new Date("2026-11-17T12:00:00.000Z");
const secondsAgo = (seconds: number) =>
  new Date(now.getTime() - seconds * 1000);

function installation(
  state: RepositoryScanInstallation["state"],
  overrides: Partial<RepositoryScanInstallation> = {},
): RepositoryScanInstallation {
  return {
    githubInstallationId: "101",
    accountLogin: "octo-org",
    state,
    requestedAt: secondsAgo(10).toISOString(),
    ...overrides,
  };
}

function snapshot(
  installations: readonly RepositoryScanInstallation[],
  overrides: Partial<RepositoryScanSnapshot> = {},
): RepositoryScanSnapshot {
  return {
    installations,
    repositoryCount: 0,
    checkedAt: now.toISOString(),
    ...overrides,
  };
}

describe("repositoryScanStateOf", () => {
  it.each([
    ["pending", "scanning"],
    ["processing", "scanning"],
    ["retry_wait", "retrying"],
    ["processed", "completed"],
    ["dead_letter", "failed"],
  ] as const)("maps a %s scan request to %s", (status, state) => {
    expect(
      repositoryScanStateOf({
        request: { status, requestedAt: secondsAgo(5) },
        installationCreatedAt: secondsAgo(3600),
        now,
      }),
    ).toEqual({ state, requestedAt: secondsAgo(5).toISOString() });
  });

  it("treats a just-created installation without a request yet as queued", () => {
    expect(
      repositoryScanStateOf({
        request: null,
        installationCreatedAt: secondsAgo(1),
        now,
      }),
    ).toEqual({ state: "scanning", requestedAt: secondsAgo(1).toISOString() });
  });

  it("does not invent a scan for an old installation without a request", () => {
    expect(
      repositoryScanStateOf({
        request: null,
        installationCreatedAt: secondsAgo(121),
        now,
      }),
    ).toEqual({ state: "unknown", requestedAt: null });
  });
});

describe("summarizeRepositoryScan", () => {
  it("reports a running scan before a failed one", () => {
    const summary = summarizeRepositoryScan(
      snapshot([
        installation("failed", { githubInstallationId: "1" }),
        installation("retrying", { githubInstallationId: "2" }),
      ]),
    );
    expect(summary).toMatchObject({ phase: "scanning", retrying: true });
  });

  it("reports failed installations when nothing runs", () => {
    expect(
      summarizeRepositoryScan(
        snapshot([
          installation("failed", { githubInstallationId: "1" }),
          installation("completed", { githubInstallationId: "2" }),
        ]),
      ),
    ).toEqual({
      phase: "failed",
      installations: [installation("failed", { githubInstallationId: "1" })],
      stalled: false,
    });
  });

  it("stops treating a scan as running after 15 minutes", () => {
    const stuck = installation("scanning", {
      requestedAt: secondsAgo(15 * 60 + 1).toISOString(),
    });
    expect(summarizeRepositoryScan(snapshot([stuck]))).toEqual({
      phase: "failed",
      installations: [stuck],
      stalled: true,
    });
    expect(repositoryScanPollIntervalMs(snapshot([stuck]))).toBe(false);
    expect(
      summarizeRepositoryScan(
        snapshot([
          { ...stuck, state: "retrying" },
          installation("failed", { githubInstallationId: "2" }),
        ]),
      ),
    ).toMatchObject({ phase: "failed", stalled: false });
    expect(
      summarizeRepositoryScan(
        snapshot([
          installation("scanning", {
            requestedAt: secondsAgo(14 * 60).toISOString(),
          }),
        ]),
      ),
    ).toMatchObject({ phase: "scanning", slow: true });
  });

  it("is idle after a completed or unknown scan", () => {
    expect(
      summarizeRepositoryScan(snapshot([installation("completed")])),
    ).toEqual({ phase: "idle", completed: true });
    expect(
      summarizeRepositoryScan(
        snapshot([installation("unknown", { requestedAt: null })]),
      ),
    ).toEqual({ phase: "idle", completed: false });
    expect(summarizeRepositoryScan(snapshot([]))).toEqual({
      phase: "idle",
      completed: false,
    });
  });

  it("marks a scan slow after two minutes", () => {
    const at = (seconds: number) =>
      summarizeRepositoryScan(
        snapshot([
          installation("scanning", {
            requestedAt: secondsAgo(seconds).toISOString(),
          }),
        ]),
      );
    expect(at(119)).toMatchObject({ slow: false });
    expect(at(121)).toMatchObject({ slow: true });
  });
});

describe("repositoryScanPollIntervalMs", () => {
  it("polls only while a scan runs", () => {
    expect(repositoryScanPollIntervalMs(undefined)).toBe(false);
    expect(
      repositoryScanPollIntervalMs(snapshot([installation("completed")])),
    ).toBe(false);
    expect(
      repositoryScanPollIntervalMs(snapshot([installation("failed")])),
    ).toBe(false);
    expect(
      repositoryScanPollIntervalMs(snapshot([installation("scanning")])),
    ).toBe(3_000);
  });

  it("keeps polling for an expected scan that is not visible yet", () => {
    const finished = snapshot([installation("completed")]);
    expect(repositoryScanPollIntervalMs(finished, 30_000)).toBe(5_000);
    expect(
      repositoryScanPollIntervalMs(snapshot([installation("failed")]), 1),
    ).toBe(5_000);
    expect(repositoryScanPollIntervalMs(finished, 0)).toBe(false);
    expect(
      repositoryScanPollIntervalMs(
        snapshot([installation("scanning")]),
        30_000,
      ),
    ).toBe(3_000);
  });

  it("backs off with the age of the oldest running scan, up to 30 s", () => {
    expect(repositoryScanBackoffMs(0)).toBe(3_000);
    expect(repositoryScanBackoffMs(40_000)).toBe(10_000);
    expect(repositoryScanBackoffMs(10 * 60_000)).toBe(30_000);
    expect(repositoryScanBackoffMs(Number.NaN)).toBe(3_000);
    expect(
      repositoryScanPollIntervalMs(
        snapshot([
          installation("scanning", {
            githubInstallationId: "1",
            requestedAt: secondsAgo(80).toISOString(),
          }),
          installation("retrying", {
            githubInstallationId: "2",
            requestedAt: secondsAgo(4).toISOString(),
          }),
        ]),
      ),
    ).toBe(20_000);
  });
});

describe("repositoryScanListRefreshKey", () => {
  const rendered = snapshot([installation("scanning")]);

  it("waits while the scan still runs", () => {
    expect(repositoryScanListRefreshKey(rendered, rendered)).toBeNull();
  });

  it("asks for one list reload when a rendered scan finishes", () => {
    const finished = snapshot([installation("completed")], {
      repositoryCount: 12,
    });
    const key = repositoryScanListRefreshKey(finished, rendered);
    expect(key).not.toBeNull();
    expect(repositoryScanListRefreshKey(finished, rendered)).toBe(key);
  });

  it("asks for a reload when a failed scan is first seen", () => {
    expect(
      repositoryScanListRefreshKey(
        snapshot([installation("failed")]),
        rendered,
      ),
    ).not.toBeNull();
  });

  it("does not reload when the server already rendered the same outcome", () => {
    const finished = snapshot([installation("completed")], {
      repositoryCount: 12,
    });
    const reRendered = { ...finished, checkedAt: secondsAgo(-5).toISOString() };
    expect(repositoryScanListRefreshKey(finished, reRendered)).toBeNull();
  });

  it("reloads when a later scan changed the list without being watched", () => {
    const before = snapshot([installation("completed")], {
      repositoryCount: 12,
    });
    const after = snapshot(
      [installation("completed", { requestedAt: secondsAgo(1).toISOString() })],
      { repositoryCount: 13 },
    );
    expect(repositoryScanListRefreshKey(after, before)).not.toBeNull();
  });
});

describe("ageRepositoryScan", () => {
  it("ages an unreadable running scan into a stall that stops polling", () => {
    const running = snapshot([installation("scanning")]);
    expect(ageRepositoryScan(running, 0)).toBe(running);
    expect(ageRepositoryScan(running, Number.NaN)).toBe(running);
    expect(
      repositoryScanPollIntervalMs(ageRepositoryScan(running, 60_000)),
    ).toBe(17_500);
    const aged = ageRepositoryScan(running, 15 * 60_000);
    expect(summarizeRepositoryScan(aged)).toMatchObject({
      phase: "failed",
      stalled: true,
    });
    expect(repositoryScanPollIntervalMs(aged)).toBe(false);
  });
});

describe("isNewerRepositoryScan", () => {
  it("prefers the later read", () => {
    const earlier = snapshot([], { checkedAt: secondsAgo(5).toISOString() });
    const later = snapshot([]);
    expect(isNewerRepositoryScan(later, earlier)).toBe(true);
    expect(isNewerRepositoryScan(earlier, later)).toBe(false);
    expect(isNewerRepositoryScan(earlier, undefined)).toBe(true);
  });
});
