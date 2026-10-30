import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import type { ExternalIdentity } from "../domain/external-identity";
import { PrismaUserRepository } from "../infrastructure/prisma/prisma-user-repository";

function fixture() {
  const user = {
    id: "persisted-user",
    githubUserId: 123n,
    githubLogin: "original",
    primaryEmail: "original@example.test",
    avatarUrl: null,
  };
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([{ locked: 1 }]),
    user: {
      create: vi.fn().mockResolvedValue(user),
      update: vi.fn().mockResolvedValue(user),
      upsert: vi.fn().mockResolvedValue(user),
    },
    userExternalIdentity: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({ user }),
    },
  };
  const prisma = {
    $transaction: vi.fn(async <T>(run: (value: typeof tx) => Promise<T>) =>
      run(tx),
    ),
  };
  return {
    tx,
    prisma,
    repository: new PrismaUserRepository(prisma as unknown as PrismaClient),
  };
}

describe("PrismaUserRepository authority boundary", () => {
  it("snapshots authority and profile before waiting for the identity lock", async () => {
    const { tx, prisma, repository } = fixture();
    let unlock!: () => void;
    tx.$queryRaw.mockImplementationOnce(
      () => new Promise<void>((resolve) => (unlock = resolve)),
    );
    const identity: ExternalIdentity = {
      provider: "github",
      externalUserId: "000123",
      login: "original",
      primaryEmail: "original@example.test",
    };
    const pending = repository.upsertExternalIdentity(identity);
    Object.assign(identity, {
      provider: "gitlab",
      externalUserId: "foreign",
      login: "changed",
      primaryEmail: "changed@example.test",
    });
    unlock();

    await expect(pending).resolves.toMatchObject({
      provider: "github",
      externalUserId: "123",
      login: "original",
      userId: "persisted-user",
    });
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "ReadCommitted",
    });
    expect(tx.userExternalIdentity.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          provider_externalUserId: {
            provider: "github",
            externalUserId: "123",
          },
        },
      }),
    );
    expect(tx.user.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { githubUserId: 123n },
        update: expect.objectContaining({ githubLogin: "original" }),
      }),
    );
  });

  it("refuses an external identity whose User has another immutable GitHub ID", async () => {
    const { tx, repository } = fixture();
    tx.userExternalIdentity.findUnique.mockResolvedValue({
      userId: "other-user",
      user: { githubUserId: 456n },
    });
    await expect(
      repository.upsertExternalIdentity({
        provider: "github",
        externalUserId: "123",
        login: "original",
      }),
    ).rejects.toThrow("external_identity_owner_conflict");
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.userExternalIdentity.upsert).not.toHaveBeenCalled();
  });

  it("refuses a changed persisted owner instead of returning a detached principal", async () => {
    const { tx, repository } = fixture();
    tx.userExternalIdentity.upsert.mockResolvedValue({
      user: {
        id: "other-user",
        githubUserId: 123n,
        githubLogin: "original",
        primaryEmail: "original@example.test",
        avatarUrl: null,
      },
    });
    await expect(
      repository.upsertGitHubUser({
        githubUserId: "123",
        githubLogin: "original",
      }),
    ).rejects.toThrow("external_identity_owner_conflict");
  });
});
