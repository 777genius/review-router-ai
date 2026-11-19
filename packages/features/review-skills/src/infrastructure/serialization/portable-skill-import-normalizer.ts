import type { ReviewSkillImportNormalizerPort } from "../../application/catalog-contracts.js";
import { parseSkillImport, SkillImportError } from "./portable-skill.js";
import { validateReviewSkillContent } from "../../application/create-review-skills-service.js";
import { canonicalSkillScanText } from "./canonical-skill-text.js";

/** Scan the fields that will actually be saved, without export-only name changes. */
export class PortableSkillImportNormalizer implements ReviewSkillImportNormalizerPort {
  async normalize(rawContent: string) {
    let parsed;
    try {
      parsed = await parseSkillImport(rawContent);
    } catch (error) {
      if (error instanceof SkillImportError)
        return { status: "unsupported" as const, reason: error.reason };
      throw error;
    }
    const content = validateReviewSkillContent(parsed.content);
    return {
      status: "supported" as const,
      value: {
        content,
        omittedFields: parsed.omittedFields,
        canonicalText: canonicalSkillScanText(content),
      },
    };
  }
}
