import { describe, expect, it, vi } from "vitest";
import {
  rotateRemovedScmRepositoryIdentityEpoch,
  rotateScmRepositoryIdentityEpoch,
} from "./scm-repository-identity-epoch";

describe("SCM repository identity epoch rotation", () => {
  it.each([
    ["bound", rotateScmRepositoryIdentityEpoch],
    ["removed", rotateRemovedScmRepositoryIdentityEpoch],
  ])(
    "advances %s identity time and version monotonically",
    async (_name, rotate) => {
      const queryRaw = vi.fn().mockResolvedValue([{ version: 4 }]);
      const input = {
        scmRepositoryIdentityId: "identity-1",
        repositoryConnectionId: "repository-1",
        currentWorkspaceId: "workspace-1",
        boundAt: new Date("2026-01-01T00:00:00.000Z"),
        removedAt: new Date("2026-01-01T00:00:00.000Z"),
      };

      await rotate({ $queryRaw: queryRaw } as never, input);

      const statement = queryRaw.mock.calls[0]![0] as { text: string };
      expect(statement.text).toContain('"version" = "version" + 1');
      expect(statement.text).toContain("GREATEST(");
      expect(statement.text).toContain("transaction_timestamp()");
      expect(statement.text).toContain("interval '1 millisecond'");
      expect(statement.text).toContain('RETURNING "version"');
    },
  );

  it("remains observable after consecutive values are persisted at millisecond precision", async () => {
    let persisted = new Date("2026-01-01T00:00:00.000Z");
    let version = 1;
    const transaction = {
      $queryRaw: vi.fn(async () => {
        persisted = new Date(persisted.getTime() + 1);
        version += 1;
        return [{ version }];
      }),
    };

    for (let index = 0; index < 2; index += 1) {
      const before = persisted;
      await rotateScmRepositoryIdentityEpoch(transaction as never, {
        scmRepositoryIdentityId: "identity-1",
        repositoryConnectionId: "repository-1",
        currentWorkspaceId: "workspace-1",
        boundAt: before,
      });
      expect(persisted.getTime()).toBeGreaterThan(before.getTime());
    }

    expect(persisted.toISOString()).toBe("2026-01-01T00:00:00.002Z");
    expect(version).toBe(3);
  });
});
