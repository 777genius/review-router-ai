import type { CodexRotatingOidcClaims } from "@reviewrouter/features-codex-oauth-rotating";
import type { ActionRepositoryContext } from "../../domain/action-control-plane.js";

export type BootstrapUsageGrant = {
  readonly grantId: string;
  readonly grantToken: string;
  readonly expiresAt: string;
  readonly scope: Readonly<Record<string, string | number | null>>;
};
/** Invoked only after the existing OIDC, immutable workflow and lease admission. */
export interface BootstrapUsageGrantPort {
  issue(input: {
    readonly publicKey: string;
    readonly claims: CodexRotatingOidcClaims;
    readonly repository: ActionRepositoryContext;
    readonly leaseId: string;
    readonly leaseExpiresAt: Date;
    readonly actionRef: string;
    readonly workflowPath: string;
  }): Promise<BootstrapUsageGrant>;
}
