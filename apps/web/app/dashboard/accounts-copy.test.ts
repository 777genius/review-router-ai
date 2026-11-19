import { describe, expect, test } from "vitest";
import {
  connectionRowStatus,
  removedFromWorkspaceText,
  removeFromWorkspaceCopy,
} from "./accounts-copy";

const ready = { state: "active", readiness: "ready" } as const;
const pendingDelete = {
  ...ready,
  lifecycle: { status: "pending", action: "delete" },
} as const;

describe("connectionRowStatus", () => {
  test.each([
    [
      "a failed read wins over everything",
      { account: pendingDelete, refreshFailed: true, localAction: "delete" },
      "unknown",
      "Details could not be refreshed",
    ],
    [
      "a local removal",
      { account: ready, localAction: "delete" },
      "removing",
      "Removing…",
    ],
    [
      "a removal the server reports wins over a local change",
      { account: pendingDelete, localAction: "suspend" },
      "removing",
      "Removing…",
    ],
    [
      "a local change",
      { account: ready, localAction: "suspend" },
      "confirming",
      "Confirming change",
    ],
    [
      "a change in progress on the server",
      { account: ready, pendingChange: true },
      "confirming",
      "Confirming change",
    ],
    ["the account's own status", { account: ready }, "ready", "Ready"],
    [
      "readiness the server could not establish",
      { account: { state: "quarantined", readiness: "unknown" } },
      "unknown",
      "Status unknown",
    ],
    [
      "a quarantined account",
      { account: { state: "quarantined", readiness: "unavailable" } },
      "attention",
      "Needs attention",
    ],
    [
      "a retired account",
      { account: { state: "tombstoned" } },
      "retired",
      "Retired",
    ],
    ["a row without a loaded account", {}, "unknown", "Status unknown"],
  ] as const)("%s", (_name, input, kind, text) => {
    expect(connectionRowStatus(input)).toEqual({ kind, text });
  });
});

describe("removedFromWorkspaceText", () => {
  test.each([
    ["remote_pending", removeFromWorkspaceCopy.pending],
    ["remote_applied", removeFromWorkspaceCopy.done],
    ["not_required", removeFromWorkspaceCopy.done],
  ] as const)("%s", (delivery, text) => {
    expect(removedFromWorkspaceText(delivery)).toBe(text);
  });
});
