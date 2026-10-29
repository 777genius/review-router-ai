import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import type { MemoryActor } from "../domain/memory-actor";
import { createPrismaMemoryRepositoryMaintainers } from "../infrastructure/prisma/prisma-memory-repository-maintainers";

const actor: MemoryActor = {
  kind: "github_user",
  id: "github-user:123",
  githubUserId: "123",
  login: "maintainer",
};
const scope = { workspaceId: "workspace-a", repositoryId: "repository-a" };

function fixture() {
  const user = vi.fn().mockResolvedValue({
    githubUserId: "123",
    githubLogin: "maintainer",
  });
  const repository = vi.fn().mockResolvedValue({
    owner: "owner",
    name: "repo",
    installation: { githubInstallationId: 77n, status: "active" },
  });
  const request = vi.fn().mockResolvedValue({
    data: { permission: "admin", user: { id: 123, login: "MAINTAINER" } },
  });
  const createClient = vi.fn().mockResolvedValue({ request });
  const port = createPrismaMemoryRepositoryMaintainers({
    prisma: {
      user: { findUnique: user },
      repositoryConnection: { findFirst: repository },
    } as unknown as PrismaClient,
    createClient,
  });
  return { port, user, repository, request, createClient };
}

describe("repository memory permission authority", () => {
  it.each([
    ["admin", undefined, "maintainer"],
    ["write", "maintain", "maintainer"],
    ["write", undefined, "not_maintainer"],
    ["read", "triage", "not_maintainer"],
    ["none", undefined, "not_maintainer"],
  ])(
    "requires maintain or admin (%s / %s)",
    async (permission, role, expected) => {
      const f = fixture();
      f.request.mockResolvedValue({
        data: {
          permission,
          role_name: role,
          user: { id: 123, login: "maintainer" },
        },
      });
      expect(await f.port.isMaintainer({ ...scope, actor })).toBe(expected);
    },
  );

  it("resolves only the selected repository in the actor's workspace", async () => {
    const f = fixture();
    expect(await f.port.isMaintainer({ ...scope, actor })).toBe("maintainer");
    expect(f.repository).toHaveBeenCalledWith({
      where: {
        id: "repository-a",
        workspaceId: "workspace-a",
        selected: true,
        archived: false,
        provider: "github",
      },
      select: {
        owner: true,
        name: true,
        installation: { select: { githubInstallationId: true, status: true } },
      },
    });
    expect(f.createClient).toHaveBeenCalledWith("77");
    expect(f.request).toHaveBeenCalledWith(
      "GET /repos/{owner}/{repo}/collaborators/{username}/permission",
      {
        owner: "owner",
        repo: "repo",
        username: "maintainer",
        request: { timeout: 1500 },
      },
    );
  });

  it.each([
    { id: 456, login: "maintainer" },
    { id: 123, login: "another-user" },
    { login: "maintainer" },
    null,
  ])(
    "rejects reassigned or unverified lookup identities (%j)",
    async (user) => {
      const f = fixture();
      f.request.mockResolvedValue({ data: { permission: "admin", user } });
      expect(await f.port.isMaintainer({ ...scope, actor })).toBe(
        "not_maintainer",
      );
    },
  );

  it("uses stored linked GitHub identity for a web user", async () => {
    const f = fixture();
    const webActor: MemoryActor = {
      kind: "workspace_user",
      id: "web-user",
      githubUserId: "wrong",
      login: "wrong",
    };
    expect(await f.port.isMaintainer({ ...scope, actor: webActor })).toBe(
      "maintainer",
    );
    expect(f.user).toHaveBeenCalledWith({
      where: { id: "web-user" },
      select: { githubUserId: true, githubLogin: true },
    });
  });

  it.each([
    { ...actor, kind: "system" as const },
    { ...actor, githubUserId: null },
    { ...actor, githubUserId: "login-only" },
    { ...actor, login: null },
  ])(
    "does not use a login as permission authority (%j)",
    async (untrustedActor) => {
      const f = fixture();
      expect(
        await f.port.isMaintainer({ ...scope, actor: untrustedActor }),
      ).toBe("not_maintainer");
      expect(f.createClient).not.toHaveBeenCalled();
    },
  );

  it.each([
    null,
    { installation: null },
    { installation: { status: "suspended" } },
  ])(
    "rejects unavailable repositories or installations (%j)",
    async (repository) => {
      const f = fixture();
      f.repository.mockResolvedValue(repository);
      expect(await f.port.isMaintainer({ ...scope, actor })).toBe(
        "not_maintainer",
      );
      expect(f.createClient).not.toHaveBeenCalled();
    },
  );

  it("fails closed when the current GitHub permission lookup is unavailable", async () => {
    const f = fixture();
    f.request.mockRejectedValue(new Error("network unavailable"));
    expect(await f.port.isMaintainer({ ...scope, actor })).toBe("unavailable");
  });
});
