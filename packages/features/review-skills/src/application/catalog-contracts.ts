import type {
  ReviewSkillContent,
  ReviewSkillDocument,
  ReviewSkillsActor,
} from "./contracts.js";

import type {
  ReviewSkillScanMode,
  ReviewSkillScanVerdict,
  ReviewSkillScanFinding,
  ReviewSkillScanProfile,
} from "../domain/catalog-security.js";
export type {
  ReviewSkillScanMode,
  ReviewSkillScanVerdict,
  ReviewSkillScanFinding,
  ReviewSkillScanProfile,
} from "../domain/catalog-security.js";
export type ReviewSkillsCatalogActor = Readonly<{
  actor: ReviewSkillsActor;
  workspaceId: string;
}>;
export type ReviewSkillsCatalogItem = Readonly<{
  id: string;
  title: string;
  repository: string | null;
  skillNameHint: string | null;
  providerUrl: string;
  available: boolean;
}>;
export type ReviewSkillsCatalogPage = Readonly<{
  items: readonly ReviewSkillsCatalogItem[];
  page: number;
  hasMore: boolean;
  limited: boolean;
  stale: boolean;
}>;
export type ReviewSkillsCatalogSelection = Readonly<{
  repository: string;
  skillNameHint?: string;
  commit?: string;
  path?: string;
}>;
export type ReviewSkillCatalogSource = Readonly<{
  repository: string;
  commit: string;
  path: string;
}>;
export type ReviewSkillImportCandidate = Readonly<{
  id: string;
  content: ReviewSkillContent;
  source: ReviewSkillCatalogSource;
  omittedFields: readonly string[];
  hasResources: boolean;
  expiresAt: string;
  aiAvailable: boolean;
}>;
export type ReviewSkillsCatalogUnresolved =
  | Readonly<{
      status: "selection_required";
      repository: string;
      commit: string;
      candidates: readonly Readonly<{ name: string; path: string }>[];
    }>
  | Readonly<{ status: "not_found" | "incomplete" }>;
export type ReviewSkillsCatalogResolution =
  | Readonly<{ status: "resolved"; candidate: ReviewSkillImportCandidate }>
  | ReviewSkillsCatalogUnresolved;
export type ReviewSkillScan = Readonly<{
  id: string;
  candidateId: string;
  mode: ReviewSkillScanMode;
  status: "queued" | "running" | "completed" | "incomplete";
  verdict: ReviewSkillScanVerdict | null;
  findings: readonly ReviewSkillScanFinding[];
  expiresAt: string;
}>;

export interface ReviewSkillsCatalogService {
  configuration(input: ReviewSkillsCatalogActor): Promise<{
    readonly aiAvailable: boolean;
    readonly scanAvailable: boolean;
  }>;
  search(
    input: ReviewSkillsCatalogActor &
      Readonly<{ query?: string; page?: number }>,
  ): Promise<ReviewSkillsCatalogPage>;
  resolve(
    input: ReviewSkillsCatalogActor & ReviewSkillsCatalogSelection,
  ): Promise<ReviewSkillsCatalogResolution>;
  loadCandidate(
    input: ReviewSkillsCatalogActor & Readonly<{ candidateId: string }>,
  ): Promise<ReviewSkillImportCandidate>;
  requestScan(
    input: ReviewSkillsCatalogActor &
      Readonly<{
        candidateId: string;
        operationId: string;
        mode: ReviewSkillScanMode;
      }>,
  ): Promise<ReviewSkillScan>;
  loadScan(
    input: ReviewSkillsCatalogActor & Readonly<{ scanId: string }>,
  ): Promise<ReviewSkillScan>;
  importCandidate(
    input: ReviewSkillsCatalogActor &
      Readonly<{
        candidateId: string;
        scanId: string;
        mode: ReviewSkillScanMode;
        acknowledgeWarnings: boolean;
        acknowledgeOmissions: boolean;
      }>,
  ): Promise<ReviewSkillDocument>;
}

export type ReviewSkillNormalizedImport = Readonly<{
  content: ReviewSkillContent;
  canonicalText: string;
  omittedFields: readonly string[];
}>;

export interface ReviewSkillsCatalogSourcePort {
  search(
    input: Readonly<{ query: string; page: number }>,
  ): Promise<ReviewSkillsCatalogPage>;
  resolve(input: ReviewSkillsCatalogSelection): Promise<
    | ReviewSkillsCatalogUnresolved
    | Readonly<{
        status: "resolved";
        source: ReviewSkillCatalogSource;
        rawContent: string;
        rawDigest: string;
        hasResources: boolean;
      }>
  >;
}
export interface ReviewSkillImportNormalizerPort {
  normalize(rawContent: string): Promise<ReviewSkillNormalizedImport>;
}
export type ReviewSkillsCatalogOperation =
  | "search"
  | "resolve"
  | "read"
  | "scan"
  | "import";
export interface ReviewSkillsCatalogAdmissionPort {
  assertAllowed(
    input: ReviewSkillsCatalogActor &
      Readonly<{ operation: ReviewSkillsCatalogOperation }>,
  ): Promise<void>;
}
export interface ReviewSkillScanExecutorPort {
  scan(
    input: Readonly<{
      jobId: string;
      attemptId: string;
      canonicalText: string;
      contentDigest: string;
      profile: ReviewSkillScanProfile;
      deadlineAt: string;
    }>,
  ): Promise<
    Readonly<{
      jobId: string;
      attemptId: string;
      contentDigest: string;
      profileFingerprint: string;
      scannerBuildId: string;
      report: unknown;
      /** The service acknowledges that the child has stopped before returning. */
      executionFinished: true;
    }>
  >;
}
