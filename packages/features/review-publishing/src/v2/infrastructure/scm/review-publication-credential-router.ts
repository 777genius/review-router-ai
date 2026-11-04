import { ReviewPublicationKind } from "../../domain/review-publication-attempt";
import {
  ReviewV2ScmCredentialPurpose,
  ReviewV2ScmProvider,
  type ReviewV2OperationCapabilityVerifierPort,
  type ReviewV2ScmCredentialAcquisitionPort,
  type ReviewV2ScmGatewaySession,
  type ReviewV2ScmMutationGateway,
} from "../../application/ports/review-publication-execution-ports";
import {
  type ReviewV2ProviderPublicationClientPort,
  type ReviewV2ProviderCredentialPort,
} from "../../application/ports/review-publication-provider-ports";

export class ProviderNeutralReviewV2ScmCredentialRouter implements ReviewV2ScmCredentialAcquisitionPort {
  private readonly providers: ReadonlyMap<
    ReviewV2ScmProvider,
    ReviewV2ProviderCredentialPort
  >;

  constructor(
    providers: readonly ReviewV2ProviderCredentialPort[],
    private readonly capabilityVerifier: ReviewV2OperationCapabilityVerifierPort,
  ) {
    const byProvider = new Map<
      ReviewV2ScmProvider,
      ReviewV2ProviderCredentialPort
    >();
    for (const provider of providers) {
      if (byProvider.has(provider.provider)) {
        throw new Error("review_v2_scm_credential_provider_duplicate");
      }
      byProvider.set(provider.provider, provider);
    }
    this.providers = byProvider;
  }

  async acquire(
    input: Parameters<ReviewV2ScmCredentialAcquisitionPort["acquire"]>[0],
  ): Promise<ReviewV2ScmGatewaySession> {
    if (
      input.operation.publicationKind === ReviewPublicationKind.PrDescription &&
      input.provider !== ReviewV2ScmProvider.GitHub
    ) {
      throw new Error("review_v2_pr_description_github_app_required");
    }
    const provider = this.providers.get(input.provider);
    if (!provider) {
      throw new Error("review_v2_scm_credential_provider_missing");
    }
    await this.capabilityVerifier.verify({
      signedCapability: input.signedCapability,
      permit: input.permit,
      operation: input.operation,
      capability: input.capability,
      claim: input.claim,
    });
    const session = await provider.acquireClient({
      purpose: input.purpose,
      permit: input.permit,
      capability: input.capability,
    });
    const gateway = createProviderGateway(input.provider, session.client);
    if (input.purpose === ReviewV2ScmCredentialPurpose.Mutate) {
      return {
        purpose: input.purpose,
        gateway,
        close: () => session.close(),
      };
    }
    return {
      purpose: input.purpose,
      gateway: {
        findAllByMarker: (request) => gateway.findAllByMarker(request),
        markStaleOrDelete: (request) => gateway.markStaleOrDelete(request),
      },
      close: () => session.close(),
    };
  }
}

/** Expose only publication operations; never return the credential client's other fields. */
function createProviderGateway(
  provider: ReviewV2ScmProvider,
  client: ReviewV2ProviderPublicationClientPort,
): ReviewV2ScmMutationGateway {
  switch (provider) {
    case ReviewV2ScmProvider.GitHub:
    case ReviewV2ScmProvider.GitLab:
      return {
        findAllByMarker: (input) => client.findAllByMarker(input),
        applyOperation: (input) => client.applyOperation(input),
        markStaleOrDelete: (input) => client.markStaleOrDelete(input),
      };
  }
}
