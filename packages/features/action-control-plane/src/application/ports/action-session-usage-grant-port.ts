import type {
  ActionRepositoryContext,
  ActionSessionClaims,
  GitHubActionsOidcClaims,
} from "../../domain/action-control-plane.js";
import type { RuntimeReviewConfigurationRecord } from "./action-control-plane-repository-port.js";
import type { BootstrapUsageGrant } from "./bootstrap-usage-grant-port.js";
/** Called after all existing session exchange admission has succeeded. */
export interface ActionSessionUsageGrantPort {
  issue(input: {
    readonly publicKey: string;
    readonly claims: GitHubActionsOidcClaims;
    readonly repository: ActionRepositoryContext;
    readonly session: ActionSessionClaims;
    readonly issuedAt: Date;
    readonly expiresAt: Date;
    readonly configuration: RuntimeReviewConfigurationRecord;
  }): Promise<readonly BootstrapUsageGrant[]>;
}
