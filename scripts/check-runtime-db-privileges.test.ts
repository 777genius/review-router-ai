import { describe, expect, it } from "vitest";
import {
  describeProblems,
  requiredPrivileges,
} from "./check-runtime-db-privileges.mjs";

describe("runtime database privilege check", () => {
  it("reports nothing when every known privilege is present", () => {
    expect(
      describeProblems({
        role: "reviewrouter_worker",
        missing: [],
        permissionDeadLetters: [],
      }),
    ).toEqual([]);
  });

  it("names the missing privilege and the dead-lettered events", () => {
    expect(
      describeProblems({
        role: "reviewrouter_worker",
        missing: [{ table: "RepositoryConnection", privilege: "UPDATE" }],
        permissionDeadLetters: [
          {
            type: "installation.sync_requested",
            count: 3,
            latest: "2026-10-29",
          },
        ],
      }),
    ).toEqual([
      "reviewrouter_worker lacks UPDATE on RepositoryConnection",
      "3 dead-lettered installation.sync_requested event(s) failed with a permission error, latest 2026-10-29",
    ]);
  });

  it("covers the grants whose absence broke repository sync in production", () => {
    expect(requiredPrivileges.reviewrouter_worker).toContainEqual({
      table: "RepositoryConnection",
      privilege: "UPDATE",
    });
  });
});
