export const BASELINE_REVISION =
  "f4839fe0ca2329ca54fb3482138a3770a73bc5fc" as const;

export const TEST_DATABASE_NAME =
  "review_router_accounts_reference_e2e_test" as const;

export const FIXTURES = Object.freeze({
  users: {
    viewer: "rr-e2e-user-viewer-0001",
    other: "rr-e2e-user-other-0001",
    foreign: "rr-e2e-user-foreign-0001",
  },
  identities: {
    viewer: {
      provider: "github",
      externalUserId: "rr-e2e-github-viewer-0001",
      login: "rr-e2e-viewer",
    },
    other: {
      provider: "gitlab",
      externalUserId: "rr-e2e-gitlab-other-0001",
      login: "rr-e2e-other-person",
    },
    foreign: {
      provider: "github",
      externalUserId: "rr-e2e-github-foreign-0001",
      login: "rr-e2e-foreign-person",
    },
  },
  workspaces: {
    personalViewer: "rr-e2e-ws-personal-viewer",
    personalOther: "rr-e2e-ws-personal-other",
    personalForeign: "rr-e2e-ws-personal-foreign",
    orgAlpha: "rr-e2e-ws-org-alpha",
    orgBravo: "rr-e2e-ws-org-bravo",
  },
  workspaceNames: {
    personalViewer: "@rr-e2e-viewer",
    personalOther: "@rr-e2e-other-person",
    personalForeign: "@rr-e2e-foreign-person",
    orgAlpha: "RR E2E Org Alpha",
    orgBravo: "RR E2E Org Bravo",
  },
  sources: {
    viewerPrimary: "rr-e2e-source-viewer-primary",
    viewerLegacyDisabled: "rr-e2e-source-viewer-legacy-disabled",
    viewerSuspendedCapable: "rr-e2e-source-viewer-suspended-capable",
    otherPrimary: "rr-e2e-source-other-primary",
    orgAlpha: "rr-e2e-source-org-alpha",
    foreignPrimary: "rr-e2e-source-foreign-primary",
  },
  sourceLabels: {
    viewerPrimary: "RR E2E Viewer Primary",
    viewerLegacyDisabled: "RR E2E Legacy Disabled",
    viewerSuspendedCapable: "RR E2E Suspended Capable",
    otherPrimary: "RR E2E Other Person Primary",
    orgAlpha: "RR E2E Org Alpha Owned",
    foreignPrimary: "RR E2E Foreign Personal",
  },
  gateway: {
    profileId: "rr-e2e-profile-mimo",
    accounts: {
      viewerPrimary: "rr-e2e-account-viewer-primary",
      viewerLegacyDisabled: "rr-e2e-account-viewer-legacy-disabled",
      viewerSuspendedCapable: "rr-e2e-account-viewer-suspended-capable",
      otherPrimary: "rr-e2e-account-other-primary",
      orgAlpha: "rr-e2e-account-org-alpha",
      foreignPrimary: "rr-e2e-account-foreign-primary",
    },
  },
  bindings: {
    viewerAlpha: "rr-e2e-binding-viewer-alpha",
    viewerBravo: "rr-e2e-binding-viewer-bravo",
    otherAlpha: "rr-e2e-binding-other-alpha",
    orgAlpha: "rr-e2e-binding-org-alpha",
  },
});

export const LOOPBACK_HOSTNAMES = new Set([
  "127.0.0.1",
  "localhost",
  "::1",
  "[::1]",
]);

export type CliOptions = {
  readonly repoRoot: string;
  readonly workDir: string;
  readonly databaseUrl: string | null;
  readonly isolatedPglite: boolean;
  readonly keepFixtures: boolean;
  readonly runBrowserTests: boolean;
  readonly expectedRevision: string;
  readonly browserExecutable: string | null;
};

export type FixtureSecrets = {
  readonly authSecret: string;
  readonly gatewayAccountsContextSecret: string;
  readonly githubClientId: string;
  readonly githubClientSecret: string;
  readonly managementToken: string;
  readonly personalControlToken: string;
};

export type RuntimeDescriptor = {
  readonly appUrl: string;
  readonly gatewayUrl: string;
  readonly databaseMode: "isolated-pglite" | "explicit-test-url";
  readonly databaseName: string;
  readonly workDir: string;
  readonly repoRoot: string;
  readonly revision: string;
  readonly baselineExpected: string;
  readonly secretsGenerated: true;
  readonly externalNetworkAllowed: false;
  readonly fixtureBoundary:
    | "UI/read contract and authorization checks only; no native suspend, resume, erasure, or lifecycle proof"
    | "not-used";
};
