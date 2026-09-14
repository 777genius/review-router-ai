export const CODEX_DEVICE_AUTH_ISSUER = "https://auth.openai.com";
export const CODEX_DEVICE_AUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
export const CODEX_DEVICE_AUTH_REDIRECT_URI =
  "https://auth.openai.com/deviceauth/callback";
export const CODEX_DEVICE_VERIFICATION_URL =
  "https://auth.openai.com/codex/device";

const USER_CODE_PATH = "/api/accounts/deviceauth/usercode";
const TOKEN_POLL_PATH = "/api/accounts/deviceauth/token";
const TOKEN_EXCHANGE_PATH = "/oauth/token";
const DEFAULT_POLL_INTERVAL_SECONDS = 3;
const REQUEST_TIMEOUT_MS = 15_000;

export type CodexDeviceAuthFetch = (
  input: string,
  init: {
    readonly method: "POST";
    readonly headers: Readonly<Record<string, string>>;
    readonly body: string;
    readonly signal?: AbortSignal;
  },
) => Promise<Response>;

export class CodexDeviceAuthGateway {
  constructor(
    private readonly options: {
      readonly fetch: CodexDeviceAuthFetch;
      readonly issuer?: string;
      readonly clientId?: string;
    },
  ) {}

  async requestUserCode(): Promise<{
    readonly deviceAuthId: string;
    readonly userCode: string;
    readonly verificationUrl: string;
    readonly intervalSeconds: number;
  }> {
    const payload = await this.postJson(USER_CODE_PATH, {
      client_id: this.clientId(),
    });
    if (!payload.ok) {
      throw new Error("hosted_pool_device_login_provider_unavailable");
    }
    const body = asObject(payload.body);
    const deviceAuthId = requiredProviderString(body.device_auth_id);
    const userCode = requiredProviderString(body.user_code ?? body.usercode);
    if (!/^[A-Za-z0-9-]{4,64}$/u.test(userCode)) {
      throw new Error("hosted_pool_device_login_provider_unavailable");
    }
    if (deviceAuthId.length < 8 || deviceAuthId.length > 256) {
      throw new Error("hosted_pool_device_login_provider_unavailable");
    }
    return {
      deviceAuthId,
      userCode,
      verificationUrl: `${this.issuer()}/codex/device`,
      intervalSeconds: readIntervalSeconds(body.interval),
    };
  }

  async pollAuthorization(input: {
    readonly deviceAuthId: string;
    readonly userCode: string;
  }): Promise<
    | { readonly status: "pending" }
    | { readonly status: "denied" }
    | { readonly status: "expired" }
    | {
        readonly status: "authorized";
        readonly authorizationCode: string;
        readonly codeVerifier: string;
      }
  > {
    const payload = await this.postJson(TOKEN_POLL_PATH, {
      device_auth_id: input.deviceAuthId,
      user_code: input.userCode,
    });
    if (
      payload.status === 403 ||
      payload.status === 404 ||
      isPendingError(payload.body)
    ) {
      return { status: "pending" };
    }
    if (!payload.ok) {
      if (isDeniedError(payload.body)) return { status: "denied" };
      if (isExpiredError(payload.body)) return { status: "expired" };
      throw new Error("hosted_pool_device_login_provider_unavailable");
    }
    const body = asObject(payload.body);
    const authorizationCode = requiredString(body.authorization_code);
    const codeVerifier = requiredString(body.code_verifier);
    return {
      status: "authorized",
      authorizationCode,
      codeVerifier,
    };
  }

  async exchangeAuthorizationCode(input: {
    readonly authorizationCode: string;
    readonly codeVerifier: string;
  }): Promise<{
    readonly idToken: string;
    readonly accessToken: string;
    readonly refreshToken: string;
  }> {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code: input.authorizationCode,
      redirect_uri: CODEX_DEVICE_AUTH_REDIRECT_URI,
      client_id: this.clientId(),
      code_verifier: input.codeVerifier,
    }).toString();
    const payload = await this.post(
      TOKEN_EXCHANGE_PATH,
      "application/x-www-form-urlencoded",
      body,
    );
    if (!payload.ok) {
      throw new Error("hosted_pool_device_login_artifact_invalid");
    }
    const object = asObject(payload.body);
    const idToken = requiredString(object.id_token);
    const accessToken = requiredString(object.access_token);
    const refreshToken = requiredString(object.refresh_token);
    return { idToken, accessToken, refreshToken };
  }

  private issuer(): string {
    return (this.options.issuer ?? CODEX_DEVICE_AUTH_ISSUER).replace(
      /\/$/u,
      "",
    );
  }

  private clientId(): string {
    return this.options.clientId ?? CODEX_DEVICE_AUTH_CLIENT_ID;
  }

  private async postJson(
    path: string,
    body: Record<string, string>,
  ): Promise<{
    readonly ok: boolean;
    readonly status: number;
    readonly body: unknown;
  }> {
    return this.post(path, "application/json", JSON.stringify(body));
  }

  private async post(
    path: string,
    contentType: string,
    body: string,
  ): Promise<{
    readonly ok: boolean;
    readonly status: number;
    readonly body: unknown;
  }> {
    let response: Response;
    try {
      response = await this.options.fetch(`${this.issuer()}${path}`, {
        method: "POST",
        headers: { "Content-Type": contentType },
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new Error("hosted_pool_device_login_provider_unavailable");
    }
    const text = await response.text();
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text) as unknown;
      } catch {
        parsed = text;
      }
    }
    return { ok: response.ok, status: response.status, body: parsed };
  }
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("hosted_pool_device_login_provider_unavailable");
  }
  return value as Record<string, unknown>;
}

function requiredProviderString(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("hosted_pool_device_login_provider_unavailable");
  }
  return value.trim();
}

function requiredString(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("hosted_pool_device_login_artifact_invalid");
  }
  return value.trim();
}

function readIntervalSeconds(value: unknown): number {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim());
    if (Number.isSafeInteger(parsed) && parsed > 0) return parsed;
  }
  return DEFAULT_POLL_INTERVAL_SECONDS;
}

function errorCode(body: unknown): string {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "";
  const record = body as Record<string, unknown>;
  const candidates = [record.error, record.error_code, record.code];
  for (const candidate of candidates) {
    if (typeof candidate === "string") return candidate;
  }
  return "";
}

function isPendingError(body: unknown): boolean {
  const code = errorCode(body);
  return (
    code === "authorization_pending" ||
    code === "deviceauth_authorization_pending"
  );
}

function isDeniedError(body: unknown): boolean {
  const code = errorCode(body);
  return code === "access_denied" || code === "deviceauth_access_denied";
}

function isExpiredError(body: unknown): boolean {
  const code = errorCode(body);
  return (
    code === "expired_token" ||
    code === "deviceauth_expired" ||
    code === "deviceauth_expired_token"
  );
}
