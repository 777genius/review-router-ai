/** Synthetic descriptors only. The actual SDK consumer validates this fixture. */
type LegacyMethod = {
  kind: string;
  method?: string;
  create: boolean;
  reconnect: boolean;
  callbackMode?: string;
  completionInputKind?: string;
};
type LegacyCapability = {
  profileId: string;
  methods: readonly LegacyMethod[];
  [key: string]: unknown;
};

const requirements = [
  "owner_scoped_custody/v1",
  "effect_fence/v1",
  "native_dispatch/v1",
];
const methodBase = {
  revision: 1,
  configurationGeneration: "visual-native-generation-1",
  create: true,
  reconnect: true,
  requirements,
  availability: "enabled",
};

export const VISUAL_NATIVE_PROFILE = "visual-native-identity-v1";
export const VISUAL_NATIVE_SECRET = "synthetic-native-secret-never-persist";
export const VISUAL_NATIVE_DOCUMENT = '{"synthetic_identity":"opaque-value"}';
export const VISUAL_NATIVE_COMPLETION =
  "opaque-native-completion-without-grammar";

export const visualNativeMethods = [
  {
    ...methodBase,
    methodId: "structured",
    label: "Service identity",
    allowedCredentialPolicies: ["cloud_identity"],
    interaction: {
      kind: "credential_form",
      inputFields: [
        {
          fieldId: "project",
          label: "Project",
          kind: "text",
          required: true,
          maxBytes: 128,
        },
        {
          fieldId: "region",
          label: "Region",
          kind: "select",
          required: true,
          maxBytes: 128,
          choices: [
            { value: "global", label: "Global" },
            { value: "eu", label: "Europe" },
          ],
        },
        {
          fieldId: "document",
          label: "Identity document",
          kind: "document",
          required: true,
          maxBytes: 65536,
        },
        {
          fieldId: "secret",
          label: "Identity secret",
          kind: "secret",
          required: true,
          maxBytes: 1024,
        },
      ],
    },
  },
  {
    ...methodBase,
    methodId: "browser",
    label: "Browser sign-in",
    allowedCredentialPolicies: ["subscription_session"],
    interaction: {
      kind: "browser",
      callbackMode: "manual",
      completionInputKind: "authorization_code",
    },
  },
  {
    ...methodBase,
    methodId: "device",
    label: "Device code",
    allowedCredentialPolicies: ["delegated_identity"],
    interaction: { kind: "device" },
  },
  {
    ...methodBase,
    methodId: "future",
    label: "Future interaction",
    allowedCredentialPolicies: ["cloud_identity"],
    interaction: { kind: "future_interaction" },
  },
];

export function nativeVisualCatalog(
  capabilities: readonly LegacyCapability[],
  includeSynthetic: boolean,
  accountInfo = false,
) {
  const converted = capabilities.map(({ methods, ...profile }) => ({
    ...profile,
    modelPolicy: {
      sourceId: profile.profileId,
      contract: "native-account-models/v2",
      unavailableFallback: "qualified_anchor",
    },
    limitsContract:
      profile.limitsContract === "none"
        ? "unsupported"
        : profile.limitsContract,
    methods: methods.map((method) => ({
      ...methodBase,
      create: method.create,
      reconnect: method.reconnect,
      methodId: method.method ?? method.kind,
      label:
        method.kind === "api_key"
          ? "API key"
          : method.kind === "browser"
            ? "Browser sign-in"
            : method.kind === "device_code"
              ? "Device code"
              : method.method === "refresh_token"
                ? "Import Refresh token"
                : "Import Codex auth.json",
      allowedCredentialPolicies: [
        method.kind === "api_key" ? "provider_key" : "subscription_session",
      ],
      interaction:
        method.kind === "browser"
          ? {
              kind: "browser",
              callbackMode:
                method.callbackMode === "manual_callback_url"
                  ? "manual"
                  : "automatic",
              completionInputKind: method.completionInputKind,
            }
          : method.kind === "device_code"
            ? { kind: "device" }
            : {
                kind: "credential_form",
                inputFields: [
                  {
                    fieldId: "credential",
                    label:
                      method.kind === "api_key"
                        ? "API key"
                        : method.method === "refresh_token"
                          ? "Refresh token"
                          : "Codex auth.json",
                    kind:
                      method.method === "oauth_auth_json"
                        ? "document"
                        : "secret",
                    required: true,
                    maxBytes: 65536,
                  },
                ],
              },
    })),
  }));
  return {
    contract: "provider-connections/v3",
    capabilities: [
      ...converted,
      ...(includeSynthetic
        ? [
            {
              profileId: VISUAL_NATIVE_PROFILE,
              provider: {
                id: "visual-new-provider",
                label: "New native provider",
              },
              product: {
                id: "mixed",
                label: "Cloud identity and subscription",
              },
              region: { id: "global", label: "Global" },
              protocol: "openai-responses",
              models: [
                {
                  modelId: "visual-native-model",
                  reasoning: null,
                  fast: null,
                  tools: { allowed: ["function"], default: "function" },
                },
              ],
              modelPolicy: {
                sourceId: "visual-new-provider",
                contract: "native-account-models/v2",
                unavailableFallback: "qualified_anchor",
              },
              methods: visualNativeMethods,
              accountInfo,
              limitsContract: "unsupported",
              availability: "enabled",
            },
          ]
        : []),
    ],
  };
}
