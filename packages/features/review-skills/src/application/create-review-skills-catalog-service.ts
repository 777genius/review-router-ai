import type {
  ReviewSkillImportNormalizerPort,
  ReviewSkillScanProfile,
  ReviewSkillsCatalogActor,
  ReviewSkillsCatalogAdmissionPort,
  ReviewSkillsCatalogOperation,
  ReviewSkillsCatalogSelection,
  ReviewSkillsCatalogService,
  ReviewSkillsCatalogSourcePort,
} from "./catalog-contracts.js";
import type { ReviewSkillsCatalogStore } from "./ports/review-skills-catalog-store.js";
import {
  ReviewSkillsError,
  ReviewSkillsErrorCode as Code,
} from "../domain/errors.js";

const identifier = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
function invalid(): never {
  throw new ReviewSkillsError(Code.InvalidInput);
}
function identity(input: ReviewSkillsCatalogActor) {
  if (
    !input ||
    !identifier.test(input.workspaceId ?? "") ||
    !identifier.test(input.actor?.userId ?? "")
  )
    invalid();
}
function requireUuid(value: string) {
  if (typeof value !== "string" || !uuid.test(value)) invalid();
}

export function validateCatalogSelection(
  input: ReviewSkillsCatalogSelection,
): ReviewSkillsCatalogSelection {
  if (
    typeof input.repository !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]{1,100}$/.test(
      input.repository,
    )
  )
    invalid();
  const repository = input.repository.toLowerCase();
  if ([".", ".."].includes(repository.split("/")[1]!)) invalid();
  if (
    input.skillNameHint !== undefined &&
    (typeof input.skillNameHint !== "string" ||
      new TextEncoder().encode(input.skillNameHint).byteLength > 512 ||
      /[\x00-\x1f\x7f]/.test(input.skillNameHint))
  )
    invalid();
  if ((input.commit === undefined) !== (input.path === undefined)) invalid();
  if (
    input.commit !== undefined &&
    (!/^[a-f0-9]{40}$/.test(input.commit) ||
      typeof input.path !== "string" ||
      new TextEncoder().encode(input.path).byteLength > 4096 ||
      /[\\\x00-\x1f\x7f]/.test(input.path) ||
      input.path.startsWith("/") ||
      (input.path !== "" &&
        input.path
          .split("/")
          .some((part) => !part || part === "." || part === "..")))
  )
    invalid();
  if (input.commit !== undefined && input.skillNameHint !== undefined)
    invalid();
  return {
    repository,
    ...(input.skillNameHint === undefined
      ? {}
      : { skillNameHint: input.skillNameHint }),
    ...(input.commit === undefined
      ? {}
      : { commit: input.commit, path: input.path! }),
  };
}

export function createReviewSkillsCatalogService(dependencies: {
  readonly store: ReviewSkillsCatalogStore;
  readonly catalog: ReviewSkillsCatalogSourcePort;
  readonly normalizer: ReviewSkillImportNormalizerPort;
  readonly admission: ReviewSkillsCatalogAdmissionPort;
  readonly profiles: readonly ReviewSkillScanProfile[];
}): ReviewSkillsCatalogService {
  const { store, catalog, normalizer, admission, profiles } = dependencies;
  const profile = (mode: unknown) => {
    if (mode !== "static" && mode !== "ai") invalid();
    return profiles.find((candidate) => candidate.mode === mode) ?? null;
  };
  const aiAvailable = Boolean(profile("ai"));
  const authorize = async (
    input: ReviewSkillsCatalogActor,
    operation: ReviewSkillsCatalogOperation,
  ) => {
    identity(input);
    await store.authorize(input);
    await admission.assertAllowed({
      actor: input.actor,
      workspaceId: input.workspaceId,
      operation,
    });
  };
  return {
    async configuration(input) {
      await authorize(input, "read");
      return { aiAvailable, scanAvailable: Boolean(profile("static")) };
    },
    async search(input) {
      await authorize(input, "search");
      if (input.query !== undefined && typeof input.query !== "string")
        invalid();
      const query = input.query?.trim() ?? "";
      const page = input.page ?? 0;
      if (
        new TextEncoder().encode(query).byteLength > 200 ||
        /[\x00-\x1f\x7f]/.test(query) ||
        !Number.isInteger(page) ||
        page < 0 ||
        page > 10000
      )
        invalid();
      return catalog.search({
        query: Array.from(query).length < 2 ? "" : query,
        page: Array.from(query).length >= 2 ? 0 : page,
      });
    },
    async resolve(input) {
      await authorize(input, "resolve");
      const resolved = await catalog.resolve(validateCatalogSelection(input));
      if (resolved.status !== "resolved") return resolved;
      const normalized = await normalizer.normalize(resolved.rawContent);
      const candidate = await store.stage({
        actor: input.actor,
        workspaceId: input.workspaceId,
        resolved,
        normalized,
      });
      return { status: "resolved", candidate: { ...candidate, aiAvailable } };
    },
    async loadCandidate(input) {
      await authorize(input, "read");
      requireUuid(input.candidateId);
      return { ...(await store.loadCandidate(input)), aiAvailable };
    },
    async requestScan(input) {
      await authorize(input, "scan");
      requireUuid(input.candidateId);
      requireUuid(input.operationId);
      const selected = profile(input.mode);
      return store.requestScan({ ...input, profile: selected });
    },
    async loadScan(input) {
      await authorize(input, "read");
      requireUuid(input.scanId);
      return store.loadScan(input);
    },
    async importCandidate(input) {
      await authorize(input, "import");
      requireUuid(input.candidateId);
      requireUuid(input.scanId);
      if (
        typeof input.acknowledgeWarnings !== "boolean" ||
        typeof input.acknowledgeOmissions !== "boolean"
      )
        invalid();
      // A committed import remains recoverable while a scanner is unavailable.
      return store.importCandidate({ ...input, profile: profile(input.mode) });
    },
  };
}
