export type EmissionSubject = {
  path: string;
  config: string;
  imports: Record<string, string>;
  modules: {
    file: string;
    exports: string[];
    typeOnly: string[];
  }[];
  consumer: string;
  rejectedConsumers: { source: string; diagnostic: string }[];
  runtime: string;
};

// Reviewed expectations, not outputs captured from the compiler being tested.
// Consumer strings are complete native-checked fixtures after adding imports;
// runtime strings deliberately exercise the actual emitted JavaScript in Node.
export const emissionSubjects: EmissionSubject[] = [
  {
    path: "packages/protocol-review-workflow",
    config: "tsconfig.build.json",
    imports: { m: "index" },
    modules: [
      {
        file: "index",
        exports: [
          "managedCodexWorkflowPath",
          "parseReviewAgentProfiles",
          "ReviewAgentProfile",
          "legacyReviewRouterWorkflowPath",
          "managedInteractionWorkflowPath",
          "managedReviewRouterWorkflowPaths",
          "reviewRouterWorkflowContract",
          "reviewRouterRuntimeWorkflowRefPattern",
          "ReviewRouterMcpSecrets",
          "renderMcpSecretsExpression",
          "readMcpSecretsExpression",
          "renderReviewRouterCaller",
          "renderReviewRouterProviderApiCaller",
          "renderReviewRouterClaudeSubscriptionCaller",
        ],
        typeOnly: ["ReviewAgentProfile", "ReviewRouterMcpSecrets"],
      },
      { file: "mcp-secrets.test", exports: [], typeOnly: [] },
    ],
    consumer: String.raw`
const value: string = m.managedCodexWorkflowPath;
type Paths = Expect<Equal<typeof m.managedReviewRouterWorkflowPaths, readonly [
  ".github/workflows/reviewrouter-review.yml",
  ".github/workflows/reviewrouter.yml",
  ".github/workflows/reviewrouter-codex.yml",
  ".github/workflows/reviewrouter-interaction.yml"
]>>;
type Secrets = Expect<Equal<m.ReviewRouterMcpSecrets, Readonly<Record<string, string>>>>;
type OptionalExpression = Expect<Equal<ReturnType<typeof m.renderMcpSecretsExpression>, string | undefined>>;
const major: 1 = m.reviewRouterWorkflowContract.major;
const required: readonly ["review_request_id", "pr_number", "review_head_sha"] =
  m.reviewRouterWorkflowContract.requiredInputs;
const binding: m.ReviewRouterMcpSecrets = { DOCS_KEY: "ORG_DOCS_TOKEN" };
const rendered: string | undefined = m.renderMcpSecretsExpression(binding);
const caller: string = m.renderReviewRouterCaller({ mcpSecrets: binding });
`,
    rejectedConsumers: [
      {
        source: "const value: boolean = m.managedCodexWorkflowPath;",
        diagnostic: "TS2322",
      },
      {
        source: "const value: string = m.renderMcpSecretsExpression({});",
        diagnostic: "TS2322",
      },
      {
        source: "m.reviewRouterWorkflowContract.major = 1;",
        diagnostic: "TS2540",
      },
      {
        source:
          'm.managedReviewRouterWorkflowPaths[0] = ".github/workflows/reviewrouter-review.yml";',
        diagnostic: "TS2540",
      },
    ],
    runtime: String.raw`
assert.equal(m.managedCodexWorkflowPath, ".github/workflows/reviewrouter-codex.yml");
assert.deepEqual(m.managedReviewRouterWorkflowPaths, [
  ".github/workflows/reviewrouter-review.yml", ".github/workflows/reviewrouter.yml",
  ".github/workflows/reviewrouter-codex.yml", ".github/workflows/reviewrouter-interaction.yml"
]);
assert.equal(m.reviewRouterWorkflowContract.major, 1);
assert.equal(Object.isFrozen(m.reviewRouterWorkflowContract), true);
assert.equal(Object.isFrozen(m.reviewRouterWorkflowContract.requiredInputs), true);
assert.deepEqual(m.reviewRouterWorkflowContract.requiredInputs,
  ["review_request_id", "pr_number", "review_head_sha"]);
const expression = "$" + "{{ format('{{\"DOCS_KEY\":{0},\"Z_KEY\":{1}}}', toJSON(secrets.ORG_DOCS_TOKEN), toJSON(secrets.Z_TOKEN)) }}";
assert.equal(m.renderMcpSecretsExpression({ Z_KEY: "Z_TOKEN", DOCS_KEY: "ORG_DOCS_TOKEN" }), expression);
assert.deepEqual(m.readMcpSecretsExpression(expression), { DOCS_KEY: "ORG_DOCS_TOKEN", Z_KEY: "Z_TOKEN" });
assert.equal(m.renderMcpSecretsExpression({}), undefined);
assert.equal(m.renderReviewRouterCaller({ mcpSecrets: {} }), m.renderReviewRouterCaller());
assert.equal(m.renderReviewRouterCaller().includes("secrets:"), false);
assert.throws(() => m.renderMcpSecretsExpression({ bad_name: "TOKEN" }), /review_workflow_mcp_secrets_invalid/);
assert.throws(() => m.readMcpSecretsExpression("inherit"), /review_workflow_mcp_secrets_invalid/);
assert.throws(() => m.renderReviewRouterCaller({ runtimeRef: "main" }), /review_workflow_runtime_ref_invalid/);
assert.throws(() => m.renderReviewRouterCaller({ controlPlaneUrl: "http://example.com" }), /review_workflow_control_plane_url_invalid/);
`,
  },
  {
    path: "packages/features/review-evidence",
    config: "tsconfig.contract-source.json",
    imports: {
      m: "contract-source/index",
      p: "domain/provider-invocation-manifest",
      e: "domain/review-evidence-primitives",
    },
    modules: [
      {
        file: "contract-source/index",
        exports: [
          "reviewEvidenceContractDescriptor",
          "reviewEvidenceActionContractFragment",
          "providerInvocationManifestV1CanonicalizerDescriptor",
        ],
        typeOnly: [],
      },
      {
        file: "domain/provider-invocation-manifest",
        exports: [
          "providerRequestEnvelopeVersion",
          "providerInvocationManifestVersion",
          "providerInvocationManifestDomain",
          "providerInvocationIdentityDomain",
          "providerInvocationManifestV1CanonicalizerDescriptor",
          "prDescriptionInvocationManifestV1CanonicalizerDescriptor",
          "ProviderRequestMessageRole",
          "CanonicalJsonPrimitive",
          "CanonicalJsonValue",
          "ProviderRequestMessage",
          "ProviderRequestEnvelope",
          "ProviderInvocationManifest",
          "ProviderInvocationIdentity",
          "canonicalizeProviderRequestEnvelope",
          "normalizeProviderInvocationManifest",
          "canonicalizeProviderInvocationManifest",
          "serializeProviderInvocationManifestCanonicalWireJson",
          "providerInvocationIdentityPreimage",
          "stableJson",
        ],
        typeOnly: [
          "CanonicalJsonPrimitive",
          "CanonicalJsonValue",
          "ProviderRequestMessage",
          "ProviderRequestEnvelope",
          "ProviderInvocationManifest",
          "ProviderInvocationIdentity",
        ],
      },
      {
        file: "domain/review-evidence-primitives",
        exports: [
          "sha256Pattern",
          "gitObjectIdPattern",
          "identifierPattern",
          "reviewEvidenceMaxTaskKinds",
          "reviewEvidenceMaxQualityFlags",
          "reviewEvidenceMaxTransportAttempts",
          "ReviewProviderKind",
          "ReviewTaskKind",
          "ProviderExecutionProfile",
          "ReviewTrustDomain",
          "ReviewObservationStatus",
          "ReviewObservationQualityFlag",
          "ReviewFindingSeverity",
          "ReviewLifecycleRevalidationVerdict",
          "ReviewEvidenceScope",
          "ReviewRevision",
          "normalizeReviewEvidenceScope",
          "normalizeReviewRevision",
          "normalizeTaskKinds",
          "normalizeQualityFlags",
          "assertSha256",
          "assertGitObjectId",
          "assertIdentifier",
          "assertBoundedString",
          "assertPositiveInteger",
          "assertNonNegativeInteger",
          "assertEpochMilliseconds",
          "compareStrings",
          "sameScope",
          "sameRevision",
        ],
        typeOnly: ["ReviewEvidenceScope", "ReviewRevision"],
      },
    ],
    consumer: String.raw`
const value: 1 = m.reviewEvidenceContractDescriptor.contractVersion;
type Primitive = Expect<Equal<p.CanonicalJsonPrimitive, string | number | boolean | null>>;
type Message = Expect<Equal<p.ProviderRequestMessage, Readonly<{
  role: p.ProviderRequestMessageRole; name: string | null; content: string;
}>>>;
const domain: "rr.provider-invocation-manifest.v1\0" = p.providerInvocationManifestDomain;
const identity: "rr.provider-invocation.v1\0" = p.providerInvocationIdentityDomain;
const json: p.CanonicalJsonValue = { list: [null, false, 2, "text"], nested: { key: 1 } };
const wire: string = p.stableJson(json);
const scope: e.ReviewEvidenceScope = {
  workspaceId: "w", repositoryConnectionId: "r", scmRepositoryIdentityId: "s",
  pullRequestNumber: 1, authorizationScopeHash: "a".repeat(64)
};
const normalized: e.ReviewEvidenceScope = e.normalizeReviewEvidenceScope(scope);
`,
    rejectedConsumers: [
      {
        source:
          "const value: boolean = m.reviewEvidenceContractDescriptor.contractVersion;",
        diagnostic: "TS2322",
      },
      {
        source: "const value: p.CanonicalJsonPrimitive = undefined;",
        diagnostic: "TS2322",
      },
      {
        source: "const value: p.CanonicalJsonValue = () => 1;",
        diagnostic: "TS2322",
      },
      {
        source:
          "declare const value: e.ReviewEvidenceScope; value.pullRequestNumber = 1;",
        diagnostic: "TS2540",
      },
      {
        source: String.raw`const value: "rr.provider-invocation-manifest.v1" = p.providerInvocationManifestDomain;`,
        diagnostic: "TS2322",
      },
    ],
    runtime: String.raw`
assert.equal(m.reviewEvidenceContractDescriptor.contractVersion, 1);
assert.equal(p.providerInvocationManifestDomain, "rr.provider-invocation-manifest.v1\0");
assert.equal(p.providerInvocationIdentityDomain, "rr.provider-invocation.v1\0");
assert.deepEqual(m.reviewEvidenceContractDescriptor.providerKinds, ["codex", "claude_code", "openrouter", "ocr"]);
assert.deepEqual(m.reviewEvidenceContractDescriptor.taskKinds, ["finding_discovery", "lifecycle_revalidation", "pr_description"]);
assert.deepEqual(m.reviewEvidenceContractDescriptor.requestMessageRoles, ["system", "developer", "user", "assistant", "tool"]);
assert.equal(Object.isFrozen(m.reviewEvidenceContractDescriptor), true);
assert.equal(Object.isFrozen(m.reviewEvidenceContractDescriptor.providerKinds), true);
assert.equal(Object.isFrozen(p.providerInvocationManifestV1CanonicalizerDescriptor.fields), true);
assert.equal(p.stableJson({ z: [null, false, 2], a: "NUL\0" }), '{"a":"NUL\\u0000","z":[null,false,2]}');
assert.throws(() => p.stableJson(-0), /canonical_json_number_invalid/);
assert.throws(() => p.stableJson(Infinity), /canonical_json_number_invalid/);
assert.deepEqual(e.normalizeTaskKinds([e.ReviewTaskKind.LifecycleRevalidation, e.ReviewTaskKind.FindingDiscovery]),
  ["finding_discovery", "lifecycle_revalidation"]);
assert.throws(() => e.normalizeTaskKinds([e.ReviewTaskKind.Unknown]), /review_evidence_task_kind_unknown/);
assert.equal(e.reviewEvidenceMaxTaskKinds, 16);
`,
  },
];

export const consumerTypeAssertions = `
type Equal<Left, Right> =
  (<T>() => T extends Left ? 1 : 2) extends
  (<T>() => T extends Right ? 1 : 2) ? true : false;
type Compatible<Left, Right> =
  [Left] extends [Right] ? [Right] extends [Left] ? true : false : false;
type Expect<T extends true> = T;
`;
