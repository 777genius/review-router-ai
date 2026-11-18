import type {
  GatewayAuthorizationState,
  RepositorySetupStepId,
} from "@reviewrouter/features-provider-setup";

/**
 * What a person needs to know about one repository on the Repositories page.
 * `not_set_up` is neutral: an untouched repository is a choice, not a problem.
 */
export type RepositorySetupState =
  | "attention"
  | "setting_up"
  | "ready"
  | "not_set_up"
  | "unavailable";

/** The filter of the repository list; one owner for its URL form as well. */
export type RepositorySetupFilter =
  | "all"
  | "private"
  | "public"
  | Exclude<RepositorySetupState, "unavailable">;

export const repositorySetupStateFilters = [
  "attention",
  "setting_up",
  "ready",
  "not_set_up",
] as const satisfies readonly RepositorySetupFilter[];

/** Facts one repository's state is decided from; composed by the caller. */
export type RepositorySetupStateFacts = Readonly<{
  /** A GitHub repository the App selects and that is not archived. */
  available: boolean;
  step: RepositorySetupStepId;
  /** The health report reads as broken (a `danger` health tone). */
  healthDanger: boolean;
  /** The health report still blocks reviews, e.g. a missing credential. */
  healthBlocksReview: boolean;
  /** The saved setup PR was closed, its branch deleted or it went wrong. */
  setupNeedsAttention: boolean;
  gatewayAuthorization: GatewayAuthorizationState | "none";
  /** Gateway accounts were read; a failed read must not paint rows red. */
  gatewayAccountsRead: boolean;
  /** A setup PR was ever requested or a workflow is already installed. */
  setupStarted: boolean;
}>;

/** The repositories ReviewRouter can set up from the dashboard. */
export function isRepositoryAvailableForSetup(repository: {
  readonly provider: string;
  readonly selected: boolean;
  readonly archived: boolean;
}): boolean {
  return (
    repository.provider === "github" &&
    repository.selected &&
    !repository.archived
  );
}

export function repositorySetupState(
  facts: RepositorySetupStateFacts,
): RepositorySetupState {
  if (!facts.available) return "unavailable";
  if (facts.healthDanger || facts.setupNeedsAttention) return "attention";
  // A pause, drain or safety block is not cleared by any setup step.
  if (facts.gatewayAuthorization === "blocked") return "attention";
  if (facts.step === "ready" && !facts.healthBlocksReview) return "ready";
  // Authorized, yet its account cannot review: the account needs attention.
  if (
    facts.gatewayAuthorization === "ready" &&
    facts.step === "provider" &&
    facts.gatewayAccountsRead
  )
    return "attention";
  return facts.setupStarted ? "setting_up" : "not_set_up";
}

const stateOrder: Readonly<Record<RepositorySetupState, number>> = {
  attention: 0,
  setting_up: 1,
  ready: 2,
  not_set_up: 3,
  unavailable: 4,
};

/** Repositories that need you first, untouched ones after; then by name. */
export function compareRepositorySetupRows(
  left: { readonly state: RepositorySetupState; readonly fullName: string },
  right: { readonly state: RepositorySetupState; readonly fullName: string },
): number {
  return (
    stateOrder[left.state] - stateOrder[right.state] ||
    left.fullName.localeCompare(right.fullName)
  );
}

export function repositoryMatchesSetupFilter(
  row: {
    readonly visibility: string;
    readonly state: RepositorySetupState;
  },
  filter: RepositorySetupFilter,
): boolean {
  switch (filter) {
    case "all":
      return true;
    case "private":
    case "public":
      return row.visibility === filter;
    default:
      return row.state === filter;
  }
}

/** Reads `setup=` or `visibility=` from a URL; anything else is `all`. */
export function readRepositorySetupFilter(
  read: (name: string) => string | null | undefined,
): RepositorySetupFilter {
  const setup = read("setup");
  const state = repositorySetupStateFilters.find((value) => value === setup);
  if (state) return state;
  const visibility = read("visibility");
  return visibility === "private" || visibility === "public"
    ? visibility
    : "all";
}

export function writeRepositorySetupFilter(
  params: URLSearchParams,
  filter: RepositorySetupFilter,
): void {
  params.delete("visibility");
  params.delete("setup");
  if (filter === "private" || filter === "public")
    params.set("visibility", filter);
  else if (filter !== "all") params.set("setup", filter);
}

export type RepositorySetupSummary = Readonly<{
  ready: number;
  settingUp: number;
  attention: number;
  notSetUp: number;
  label: string;
  tone: "success" | "warning" | "danger" | "neutral";
}>;

/** Counts of the repositories that can be set up; unavailable ones are left out. */
export function summarizeRepositorySetup(
  states: readonly RepositorySetupState[],
): RepositorySetupSummary {
  const counts = { ready: 0, settingUp: 0, attention: 0, notSetUp: 0 };
  for (const state of states) {
    if (state === "ready") counts.ready += 1;
    else if (state === "setting_up") counts.settingUp += 1;
    else if (state === "attention") counts.attention += 1;
    else if (state === "not_set_up") counts.notSetUp += 1;
  }
  if (counts.attention > 0)
    return {
      ...counts,
      label: `${counts.attention} need attention`,
      tone: "danger",
    };
  if (counts.settingUp > 0)
    return { ...counts, label: `${counts.settingUp} setting up`, tone: "warning" };
  if (counts.ready > 0)
    return { ...counts, label: `${counts.ready} ready`, tone: "success" };
  return {
    ...counts,
    label:
      counts.notSetUp > 0 ? "No repositories set up yet" : "No repositories synced",
    tone: "neutral",
  };
}

/**
 * The first-run hint stays until any repository starts its setup. It rests on
 * stored setup records, so a failed provider read cannot bring it back.
 */
export function showsFirstRunGuide(
  states: readonly RepositorySetupState[],
): boolean {
  return (
    states.some((state) => state === "not_set_up") &&
    states.every((state) => state === "not_set_up" || state === "unavailable")
  );
}
