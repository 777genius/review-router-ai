import {
  applyGitHubUserAuthorizationTokenCheckInTransaction,
  decryptServerToken,
  readGitHubUserAuthorizationTokenSnapshot,
  resolveGitHubUserAuthorizationAppSlug,
  type GitHubUserAuthorizationEnvironment,
  type GitHubUserAuthorizationTokenSnapshot,
} from "@reviewrouter/features-auth";
import {
  runWebhookFencedDatabaseEffect,
  type FencedDelivery,
  type GitHubAppAuthorizationWebhookEnvelope,
} from "@reviewrouter/features-github-installations";
import type { Prisma } from "@prisma/client";
import type { PrismaClient } from "@reviewrouter/platform-db";

type AuthorizationObservation =
  | {
      ignoredReason:
        | "authorization_not_found"
        | "authorization_already_revoked";
    }
  | {
      snapshot: GitHubUserAuthorizationTokenSnapshot;
      tokenStatus: "valid" | "invalid";
    };
const reconciliationRequired =
  "github_app_authorization_reconciliation_required";

export class PrismaGitHubAppAuthorizationWebhookHandler {
  private readonly env: GitHubUserAuthorizationEnvironment;
  private readonly send: typeof fetch;
  private readonly userEndpoint: string;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly appSlug = resolveGitHubUserAuthorizationAppSlug(),
    options: Readonly<{
      env?: GitHubUserAuthorizationEnvironment;
      fetch?: typeof fetch;
    }> = {},
  ) {
    this.env = options.env ?? process.env;
    this.send = options.fetch ?? fetch;
    const api = new URL(
      this.env.GITHUB_API_BASE_URL ?? "https://api.github.com",
    );
    if (
      api.protocol !== "https:" ||
      api.username ||
      api.password ||
      api.search ||
      api.hash
    )
      throw new Error("github_app_authorization_probe_config_invalid");
    this.userEndpoint = api.href.replace(/\/+$/, "") + "/user";
  }

  async handleGitHubAppAuthorizationWebhook(
    envelope: GitHubAppAuthorizationWebhookEnvelope,
  ): Promise<Record<string, unknown>> {
    const observation = await this.observeCurrentAuthorization(envelope);
    return this.prisma.$transaction(
      (transaction) =>
        this.applyObservation(transaction, envelope, observation),
      { isolationLevel: "ReadCommitted" },
    );
  }

  /** A signed body requests reconciliation; it does not identify the current grant. */
  async handleFencedGitHubAppAuthorizationWebhook(
    envelope: GitHubAppAuthorizationWebhookEnvelope,
    claim: FencedDelivery,
  ): Promise<Record<string, unknown>> {
    if (claim.deliveryId !== envelope.deliveryId || !envelope.payloadHash)
      throw new Error("webhook_fence_identity_mismatch");
    const observation = await this.observeCurrentAuthorization(envelope);
    return runWebhookFencedDatabaseEffect(
      this.prisma,
      claim,
      async (transaction) => {
        const delivery = await transaction.gitHubWebhookDelivery.findUnique({
          where: { deliveryId: claim.deliveryId },
          select: { eventName: true, action: true, payloadHash: true },
        });
        if (
          delivery?.eventName !== envelope.eventName ||
          delivery.action !== envelope.payload.action ||
          delivery.payloadHash !== envelope.payloadHash
        )
          throw new Error("webhook_fence_identity_mismatch");
        const result = await this.applyObservation(
          transaction,
          envelope,
          observation,
        );
        await transaction.gitHubWebhookDelivery.update({
          where: { deliveryId: claim.deliveryId },
          data: { status: "processed", processedAt: new Date() },
        });
        return result;
      },
      "processed",
    );
  }

  private async observeCurrentAuthorization(
    envelope: GitHubAppAuthorizationWebhookEnvelope,
  ): Promise<AuthorizationObservation> {
    const snapshot = await readGitHubUserAuthorizationTokenSnapshot(
      this.prisma,
      BigInt(envelope.payload.sender.id),
      this.appSlug,
    );
    if (!snapshot) return { ignoredReason: "authorization_not_found" };
    if (snapshot.revokedAt)
      return { ignoredReason: "authorization_already_revoked" };
    if (snapshot.eligible !== true) throw new Error(reconciliationRequired);

    let response: Response;
    try {
      const token = decryptServerToken(snapshot.encryptedAccessToken, this.env);
      response = await this.send(this.userEndpoint, {
        method: "GET",
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(5_000),
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28",
        },
      });
    } catch {
      throw new Error(reconciliationRequired);
    }
    try {
      if (response.status === 401) return { snapshot, tokenStatus: "invalid" };
      if (response.status === 200) {
        const user: unknown = await response.json();
        if (
          user !== null &&
          typeof user === "object" &&
          "id" in user &&
          typeof user.id === "number" &&
          Number.isSafeInteger(user.id) &&
          BigInt(user.id) === snapshot.githubUserId
        )
          return { snapshot, tokenStatus: "valid" };
      }
      throw new Error(reconciliationRequired);
    } catch {
      throw new Error(reconciliationRequired);
    } finally {
      try {
        await response.body?.cancel();
      } catch {
        // Cleanup cannot change the observed status or parsed user identity.
      }
    }
  }

  private async applyObservation(
    transaction: Prisma.TransactionClient,
    envelope: GitHubAppAuthorizationWebhookEnvelope,
    observation: AuthorizationObservation,
  ): Promise<Record<string, unknown>> {
    const common = {
      appSlug: this.appSlug,
      githubUserId: String(envelope.payload.sender.id),
    };
    if ("ignoredReason" in observation)
      return {
        ...common,
        processed: false,
        ignored: true,
        reason: observation.ignoredReason,
      };
    if (
      !(await applyGitHubUserAuthorizationTokenCheckInTransaction(
        transaction,
        observation.snapshot,
        observation.tokenStatus,
      ))
    )
      throw new Error(reconciliationRequired);
    return observation.tokenStatus === "valid"
      ? {
          ...common,
          processed: false,
          ignored: true,
          reason: "authorization_still_valid",
        }
      : { ...common, processed: true, userCount: 1 };
  }
}
