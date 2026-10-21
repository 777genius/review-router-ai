import { expect, it } from "vitest";
import { ReviewTaskKind } from "../packages/features/review-executions/src/domain/review-execution";
import { taskKindToPrisma } from "../packages/features/review-executions/src/infrastructure/prisma/prisma-review-execution-mappers";
import { ReviewPublicationKind } from "../packages/features/review-publishing/src/v2/domain/review-publication-attempt";
import { toDbPublicationKind } from "../packages/features/review-publishing/src/v2/infrastructure/prisma/review-publication-prisma-mappers";

it("keeps published PR-description descriptors outside unactivated database purposes", () => {
  expect(() => taskKindToPrisma(ReviewTaskKind.PrDescription)).toThrow(
    "review_execution_pr_description_unsupported",
  );
  expect(() =>
    toDbPublicationKind(ReviewPublicationKind.PrDescription),
  ).toThrow("review_publication_pr_description_unsupported");
  expect(taskKindToPrisma(ReviewTaskKind.FindingDiscovery)).toBe(
    "finding_discovery",
  );
  expect(toDbPublicationKind(ReviewPublicationKind.Summary)).toBe("summary");
});
