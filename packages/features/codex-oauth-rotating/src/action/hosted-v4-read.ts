import { z } from "zod";
import type { HostedV4Authorization } from "./hosted-v4-authorize.js";
import { fetchHostedV4Json } from "./hosted-v4-http.js";

const timestamp = z.iso.datetime({ offset: true });
const signedCapability = z
  .string()
  .min(1)
  .max(4096)
  .regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/u);
const capabilityResponse = z.strictObject({
  capability: signedCapability,
  expiresAt: timestamp,
});
const fileResponse = z.strictObject({
  path: z.string().min(1).max(1024),
  headSha: z.string().regex(/^[a-f0-9]{40}$/u),
  blobSha: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u),
  contentBase64: z.string(),
});

export type HostedV4ReadCapability = Readonly<{
  capability: string;
  expiresAt: string;
  headSha: string;
  authorizationId: string;
}>;

export type HostedV4ReadClient = Readonly<{
  admit(input: {
    readonly authorization: HostedV4Authorization;
    /** Current binding is checked by the server; v2 has no binding field. */
    readonly binding: {
      readonly repositoryConnectionId: string;
      readonly providerInstanceId: string;
      readonly bindingId: string;
      readonly bindingVersion: number;
    };
  }): Promise<HostedV4ReadCapability>;
  refresh(input: {
    readonly authorization: HostedV4Authorization;
    readonly read: HostedV4ReadCapability;
  }): Promise<HostedV4ReadCapability>;
  readFile(input: {
    readonly read: HostedV4ReadCapability;
    readonly path: string;
  }): Promise<{
    readonly path: string;
    readonly headSha: string;
    readonly blobSha: string;
    readonly contentBase64: string;
  }>;
}>;

/** Private v4-only read port. Each operation makes one request and fails closed. */
export function createHostedV4ReadClient(input: {
  readonly fetchImpl: typeof fetch;
  readonly apiUrl: string;
  readonly maskSecret: (secret: string) => void;
  readonly now?: () => Date;
}): HostedV4ReadClient {
  const origin = new URL(input.apiUrl);
  if (
    origin.protocol !== "https:" ||
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    origin.pathname !== "/"
  )
    throw new Error("hosted_v4_api_url_invalid");
  const now = input.now ?? (() => new Date());
  const request = async (
    path: string,
    body: object,
    status: number,
  ): Promise<unknown> => {
    const response = await fetchHostedV4Json({
      fetchImpl: input.fetchImpl,
      url: new URL(path, origin).toString(),
      init: {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        redirect: "error",
        body: JSON.stringify(body),
      },
      acceptedStatuses: [status],
      timeoutMs: 15_000,
      maxBytes: path === "/api/hosted/v4/files/read" ? 1_500_000 : 8 * 1024,
      errorPrefix: "hosted_v4_read",
    });
    return response.body;
  };
  const validateRead = (read: HostedV4ReadCapability): void => {
    if (
      !signedCapability.safeParse(read.capability).success ||
      !Number.isFinite(Date.parse(read.expiresAt)) ||
      Date.parse(read.expiresAt) <= now().getTime()
    )
      throw new Error("hosted_v4_read_capability_expired_or_malformed");
  };
  const parseCapability = (
    raw: unknown,
    authorization: HostedV4Authorization,
  ): HostedV4ReadCapability => {
    if (
      raw &&
      typeof raw === "object" &&
      "capability" in raw &&
      typeof raw.capability === "string" &&
      raw.capability
    )
      input.maskSecret(raw.capability);
    const parsed = capabilityResponse.safeParse(raw);
    if (
      !parsed.success ||
      Date.parse(parsed.data.expiresAt) <= now().getTime() ||
      Date.parse(parsed.data.expiresAt) > Date.parse(authorization.expiresAt)
    )
      throw new Error("hosted_v4_read_capability_malformed");
    return {
      ...parsed.data,
      headSha: authorization.headSha,
      authorizationId: authorization.authorizationId,
    };
  };
  return {
    async admit({ authorization, binding }) {
      if (
        authorization.binding.kind !== "server_binding_contract_gap" ||
        binding.repositoryConnectionId !==
          authorization.repositoryConnectionId ||
        !binding.providerInstanceId ||
        !binding.bindingId ||
        !Number.isSafeInteger(binding.bindingVersion) ||
        binding.bindingVersion < 1 ||
        Date.parse(authorization.expiresAt) <= now().getTime()
      )
        throw new Error("hosted_v4_authority_stale_or_unsupported");
      const raw = await request(
        "/api/hosted/v4/read-capabilities",
        {
          authorizationToken: authorization.authorizationToken,
          repositoryConnectionId: binding.repositoryConnectionId,
          providerInstanceId: binding.providerInstanceId,
          bindingId: binding.bindingId,
          bindingVersion: binding.bindingVersion,
        },
        201,
      );
      return parseCapability(raw, authorization);
    },
    async refresh({ authorization, read }) {
      validateRead(read);
      if (
        read.authorizationId !== authorization.authorizationId ||
        read.headSha !== authorization.headSha ||
        Date.parse(authorization.expiresAt) <= now().getTime()
      )
        throw new Error("hosted_v4_authority_stale_or_unsupported");
      const raw = await request(
        "/api/hosted/v4/read-capabilities/refresh",
        {
          capability: read.capability,
          authorizationToken: authorization.authorizationToken,
        },
        200,
      );
      return parseCapability(raw, authorization);
    },
    async readFile({ read, path }) {
      validateRead(read);
      if (!validPath(path)) throw new Error("hosted_v4_read_path_invalid");
      const raw = await request(
        "/api/hosted/v4/files/read",
        {
          capability: read.capability,
          path,
        },
        200,
      );
      const parsed = fileResponse.safeParse(raw);
      if (
        !parsed.success ||
        parsed.data.path !== path ||
        parsed.data.headSha !== read.headSha
      )
        throw new Error("hosted_v4_read_malformed_or_stale");
      const bytes = Buffer.from(parsed.data.contentBase64, "base64");
      if (
        bytes.length > 1_000_000 ||
        bytes.toString("base64") !== parsed.data.contentBase64
      )
        throw new Error("hosted_v4_read_malformed_or_stale");
      return parsed.data;
    },
  };
}

function validPath(path: string): boolean {
  return (
    path.length > 0 &&
    path.length <= 1024 &&
    !path.startsWith("/") &&
    path
      .split("/")
      .every((part) => part !== "" && part !== "." && part !== "..") &&
    Array.from(path).every((character) => {
      const code = character.charCodeAt(0);
      return (
        character !== "\\" && character !== "%" && code >= 0x20 && code !== 0x7f
      );
    })
  );
}
