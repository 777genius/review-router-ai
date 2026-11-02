import type { ReviewSkillImportNormalizerPort } from "../../application/catalog-contracts.js";
import {
  ReviewSkillsError,
  ReviewSkillsErrorCode,
} from "../../domain/errors.js";
import { parseSkillImport } from "./portable-skill.js";
import { validateReviewSkillContent } from "../../application/create-review-skills-service.js";
import { canonicalSkillScanText } from "./canonical-skill-text.js";

/** Scan the fields that will actually be saved, without export-only name changes. */
export class PortableSkillImportNormalizer implements ReviewSkillImportNormalizerPort {
  async normalize(rawContent: string) {
    try {
      const parsed = await parseSkillImport(rawContent);
      const content = validateReviewSkillContent(parsed.content);
      return {
        content,
        omittedFields: parsed.omittedFields,
        canonicalText: canonicalSkillScanText(content),
      };
    } catch {
      throw new ReviewSkillsError(ReviewSkillsErrorCode.Unsupported);
    }
  }
}
