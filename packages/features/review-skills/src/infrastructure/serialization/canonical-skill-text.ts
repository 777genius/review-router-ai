import type { ReviewSkillContent } from "../../application/contracts.js";

/** Both staging and execution bind the exact fields accepted by Skills creation. */
export function canonicalSkillScanText(content: ReviewSkillContent): string {
  return `---\nname: ${JSON.stringify(content.name)}\ndescription: ${JSON.stringify(content.description)}\n---\n${content.instructions}`;
}
