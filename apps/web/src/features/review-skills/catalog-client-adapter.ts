import { executeSkillCatalog } from "../../../app/dashboard/skill-catalog-actions";
import type {
  SkillCatalogInput,
  SkillCatalogMethod,
  SkillCatalogValue,
} from "./catalog-contracts";

export class SkillCatalogClientError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "SkillCatalogClientError";
  }
}

export async function requestSkillCatalog<K extends SkillCatalogMethod>(
  method: K,
  input: SkillCatalogInput<K>,
): Promise<SkillCatalogValue<K>> {
  try {
    const response = await executeSkillCatalog({ method, input });
    if (response.status !== "ok")
      throw new SkillCatalogClientError(
        response.code,
        response.message,
        response.retryAfterSeconds,
      );
    return response.value;
  } catch (error) {
    if (error instanceof SkillCatalogClientError) throw error;
    throw new SkillCatalogClientError(
      "unknown",
      "The result could not be confirmed. Your selection is saved here. Retry the same action to recover its result.",
    );
  }
}
