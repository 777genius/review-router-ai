import type { Session } from "next-auth";

type SessionSourceIdentity = {
  readonly sourceProvider: "github" | "gitlab";
  readonly externalUserId: string;
  readonly sourceLogin: string;
  readonly sourceAvatarUrl: string | null;
  readonly githubUserId: string | null;
  readonly githubLogin: string | null;
};

export function readSessionSourceIdentity(
  session: Session | null,
): SessionSourceIdentity | null {
  const user = session?.user;
  const sourceProvider = user?.sourceProvider;
  const externalUserId = user?.externalUserId;
  const sourceLogin = user?.sourceLogin;
  // Legacy sessions have no modern source tuple. A present malformed modern
  // tuple must not fall back to another provider's identity.
  if (sourceProvider == null && externalUserId == null && sourceLogin == null) {
    if (
      user &&
      isNonblankSessionIdentityField(user.githubUserId) &&
      isNonblankSessionIdentityField(user.githubLogin)
    ) {
      return {
        sourceProvider: "github",
        externalUserId: user.githubUserId,
        sourceLogin: user.githubLogin,
        sourceAvatarUrl: user?.githubAvatarUrl ?? null,
        githubUserId: user.githubUserId,
        githubLogin: user.githubLogin,
      };
    }
    return null;
  }
  if (
    (sourceProvider !== "github" && sourceProvider !== "gitlab") ||
    !isNonblankSessionIdentityField(externalUserId) ||
    !isNonblankSessionIdentityField(sourceLogin)
  )
    return null;
  if (sourceProvider === "github") {
    if (
      (user?.githubUserId != null &&
        !isNonblankSessionIdentityField(user.githubUserId)) ||
      (user?.githubLogin != null &&
        !isNonblankSessionIdentityField(user.githubLogin))
    )
      return null;
  }
  return {
    sourceProvider,
    externalUserId,
    sourceLogin,
    sourceAvatarUrl:
      user?.sourceAvatarUrl ??
      (sourceProvider === "github"
        ? user?.githubAvatarUrl
        : user?.gitlabAvatarUrl) ??
      null,
    githubUserId: user?.githubUserId ?? null,
    githubLogin: user?.githubLogin ?? null,
  };
}

function isNonblankSessionIdentityField(value: unknown): value is string {
  // Keep the decoded identity unchanged; only validate its primitive contract.
  return typeof value === "string" && value.trim().length > 0;
}

export function localIdentityMatchesSession(
  identity: SessionSourceIdentity,
  user: {
    readonly githubUserId: string | null;
    readonly githubLogin: string | null;
  },
): boolean {
  if (identity.sourceProvider !== "github") {
    return true;
  }
  return (
    user.githubUserId !== null &&
    user.githubLogin !== null &&
    user.githubUserId === identity.externalUserId &&
    (identity.githubUserId === null ||
      identity.githubUserId === user.githubUserId)
  );
}
