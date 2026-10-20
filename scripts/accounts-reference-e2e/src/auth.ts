import { encode } from "next-auth/jwt";
import { FIXTURES, type FixtureSecrets } from "./contracts.ts";

export type SessionIdentity = {
  readonly userId: string;
  readonly sourceProvider: "github" | "gitlab";
  readonly externalUserId: string;
  readonly sourceLogin: string;
  readonly sourceAvatarUrl: string | null;
};

export function viewerIdentity(): SessionIdentity {
  return {
    userId: FIXTURES.users.viewer,
    sourceProvider: "github",
    externalUserId: FIXTURES.identities.viewer.externalUserId,
    sourceLogin: FIXTURES.identities.viewer.login,
    sourceAvatarUrl: fixtureAvatar("rr-e2e-viewer"),
  };
}

export function otherIdentity(): SessionIdentity {
  return {
    userId: FIXTURES.users.other,
    sourceProvider: "gitlab",
    externalUserId: FIXTURES.identities.other.externalUserId,
    sourceLogin: FIXTURES.identities.other.login,
    sourceAvatarUrl: fixtureAvatar("rr-e2e-other-person"),
  };
}

export function fixtureAvatar(label: string): string {
  const safe = encodeURIComponent(label);
  return `data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${safe}"%3E%3Crect width="32" height="32" fill="%23233044"/%3E%3C/svg%3E`;
}

export async function createSessionCookie(
  identity: SessionIdentity,
  secrets: FixtureSecrets,
  appUrl: string,
): Promise<{
  readonly name: string;
  readonly value: string;
  readonly header: string;
}> {
  const secure = appUrl.startsWith("https:");
  const name = secure
    ? "__Secure-next-auth.session-token"
    : "next-auth.session-token";
  const token = {
    sub: identity.userId,
    name: identity.sourceLogin,
    email: `${identity.sourceLogin}@invalid.test`,
    picture: identity.sourceAvatarUrl,
    sourceProvider: identity.sourceProvider,
    externalUserId: identity.externalUserId,
    sourceLogin: identity.sourceLogin,
    sourceAvatarUrl: identity.sourceAvatarUrl,
    ...(identity.sourceProvider === "github"
      ? {
          githubUserId: identity.externalUserId,
          githubLogin: identity.sourceLogin,
          githubAvatarUrl: identity.sourceAvatarUrl,
        }
      : {
          gitlabUserId: identity.externalUserId,
          gitlabLogin: identity.sourceLogin,
          gitlabAvatarUrl: identity.sourceAvatarUrl,
        }),
  };
  const value = await encode({
    token: token as never,
    secret: secrets.authSecret,
    salt: "",
    maxAge: 30 * 24 * 60 * 60,
  });
  return {
    name,
    value,
    header: `${name}=${value}`,
  };
}
