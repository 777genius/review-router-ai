import type { ReviewSkillDocument } from "../contracts.js";
import type {
  ReviewSkillImportCandidate,
  ReviewSkillNormalizedImport,
  ReviewSkillScan,
  ReviewSkillScanProfile,
  ReviewSkillsCatalogActor,
  ReviewSkillsCatalogService,
  ReviewSkillsCatalogSourcePort,
} from "../catalog-contracts.js";
import type { ReviewSkillScanReport } from "../../domain/catalog-security.js";
export type { ReviewSkillScanReport } from "../../domain/catalog-security.js";

export type ResolvedCatalogSource = Extract<
  Awaited<ReturnType<ReviewSkillsCatalogSourcePort["resolve"]>>,
  { status: "resolved" }
>;
export type ReviewSkillScanClaim = Readonly<{
  jobId: string;
  claimId: string;
  claimVersion: bigint;
  claimUntil: Date;
}>;
export type ReviewSkillScanExecution = Readonly<{
  jobId: string;
  attemptId: string;
  canonicalText: string;
  contentDigest: string;
  profile: ReviewSkillScanProfile;
  deadlineAt: string;
}>;
type Arg<K extends keyof ReviewSkillsCatalogService> = Parameters<
  ReviewSkillsCatalogService[K]
>[0];
export interface ReviewSkillsCatalogStore {
  authorize(input: ReviewSkillsCatalogActor): Promise<void>;
  stage(
    input: ReviewSkillsCatalogActor &
      Readonly<{
        resolved: ResolvedCatalogSource;
        normalized: ReviewSkillNormalizedImport;
      }>,
  ): Promise<Omit<ReviewSkillImportCandidate, "aiAvailable">>;
  loadCandidate(
    input: Arg<"loadCandidate">,
  ): Promise<Omit<ReviewSkillImportCandidate, "aiAvailable">>;
  requestScan(
    input: Arg<"requestScan"> &
      Readonly<{ profile: ReviewSkillScanProfile | null }>,
  ): Promise<ReviewSkillScan>;
  loadScan(input: Arg<"loadScan">): Promise<ReviewSkillScan>;
  importCandidate(
    input: Arg<"importCandidate"> &
      Readonly<{ profile: ReviewSkillScanProfile | null }>,
  ): Promise<ReviewSkillDocument>;
  beginScan(
    claim: ReviewSkillScanClaim,
    profiles: readonly ReviewSkillScanProfile[],
  ): Promise<
    | Readonly<{ status: "started"; execution: ReviewSkillScanExecution }>
    | Readonly<{ status: "finished" | "busy" }>
  >;
  finishScan(
    input: ReviewSkillScanClaim &
      Readonly<{ report: ReviewSkillScanReport; confirmedExit: boolean }>,
  ): Promise<boolean>;
  pruneExpired(
    input: Readonly<{ limit: number }>,
  ): Promise<Readonly<{ deleted: number }>>;
}
