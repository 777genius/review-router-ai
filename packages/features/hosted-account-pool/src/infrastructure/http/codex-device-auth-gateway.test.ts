import { describe, expect, it, vi } from "vitest";
import {
  CodexDeviceAuthGateway,
  CODEX_DEVICE_AUTH_CLIENT_ID,
  CODEX_DEVICE_AUTH_ISSUER,
} from "./codex-device-auth-gateway";

describe("CodexDeviceAuthGateway", () => {
  it("requests a user code from the public Codex device-auth endpoints", async () => {
    const fetch = vi.fn(
      async (url: string, init: { readonly body: string }) => {
        expect(url).toBe(
          `${CODEX_DEVICE_AUTH_ISSUER}/api/accounts/deviceauth/usercode`,
        );
        expect(JSON.parse(init.body)).toEqual({
          client_id: CODEX_DEVICE_AUTH_CLIENT_ID,
        });
        return jsonResponse({
          device_auth_id: "device-auth-secret",
          user_code: "WXYZ-1234",
          interval: "5",
        });
      },
    );
    const gateway = new CodexDeviceAuthGateway({ fetch });
    await expect(gateway.requestUserCode()).resolves.toEqual({
      deviceAuthId: "device-auth-secret",
      userCode: "WXYZ-1234",
      verificationUrl: `${CODEX_DEVICE_AUTH_ISSUER}/codex/device`,
      intervalSeconds: 5,
    });
  });

  it("treats 403/404 token polls as pending and exchanges the authorization code", async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url.endsWith("/deviceauth/token")) {
        return new Response("{}", { status: 403 });
      }
      expect(url).toBe(`${CODEX_DEVICE_AUTH_ISSUER}/oauth/token`);
      return jsonResponse({
        id_token: "id",
        access_token: "access",
        refresh_token: "refresh",
      });
    });
    const gateway = new CodexDeviceAuthGateway({ fetch });
    await expect(
      gateway.pollAuthorization({
        deviceAuthId: "device-auth-secret",
        userCode: "WXYZ-1234",
      }),
    ).resolves.toEqual({ status: "pending" });
    await expect(
      gateway.exchangeAuthorizationCode({
        authorizationCode: "code",
        codeVerifier: "verifier",
      }),
    ).resolves.toEqual({
      idToken: "id",
      accessToken: "access",
      refreshToken: "refresh",
    });
  });

  it("does not treat a missing refresh token as a valid artifact", async () => {
    const gateway = new CodexDeviceAuthGateway({
      fetch: vi.fn(async () =>
        jsonResponse({
          id_token: "id",
          access_token: "access",
        }),
      ),
    });
    await expect(
      gateway.exchangeAuthorizationCode({
        authorizationCode: "code",
        codeVerifier: "verifier",
      }),
    ).rejects.toThrow("hosted_pool_device_login_artifact_invalid");
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
