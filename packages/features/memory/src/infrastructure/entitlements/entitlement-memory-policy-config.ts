import {
  evaluateFeatureEntitlement,
  freeBetaEntitlement,
  type EntitlementRepositoryPort,
} from "@reviewrouter/features-entitlements";
import { MemoryKnowledgeError } from "../../domain/memory-knowledge";
import {
  createMemoryPolicyConfig,
  type MemoryPolicyConfig,
  type MemoryPolicyConfigOverrides,
  type MemoryPolicyConfigPort,
} from "../../application/ports/memory-policy-config-port";

export type EntitlementMemoryPolicyConfigOptions = {
  readonly serviceEnabled?: boolean;
  readonly defaults?: MemoryPolicyConfigOverrides;
};

export class EntitlementMemoryPolicyConfig implements MemoryPolicyConfigPort {
  private readonly serviceEnabled: boolean;
  private readonly defaults: MemoryPolicyConfigOverrides;

  constructor(
    private readonly entitlements: EntitlementRepositoryPort,
    options: EntitlementMemoryPolicyConfigOptions = {},
  ) {
    this.serviceEnabled = options.serviceEnabled ?? true;
    this.defaults = options.defaults ?? {};
  }

  async getPolicy(input: {
    readonly workspaceId: string;
    readonly repositoryId?: string | null;
  }): Promise<MemoryPolicyConfig> {
    const workspaceId = input.workspaceId.trim();
    if (!workspaceId) {
      throw new MemoryKnowledgeError("invalid_input");
    }

    const basePolicy = createMemoryPolicyConfig(this.defaults);
    if (!this.serviceEnabled) {
      return createMemoryPolicyConfig({
        ...basePolicy,
        memoryEnabled: false,
      });
    }

    const entitlement =
      (await this.entitlements.findWorkspaceEntitlement(workspaceId)) ??
      freeBetaEntitlement(workspaceId);
    const balancedMemory = evaluateFeatureEntitlement({
      entitlement,
      feature: "balanced_memory",
    });

    return createMemoryPolicyConfig({
      ...basePolicy,
      memoryEnabled: balancedMemory.allowed,
    });
  }
}
