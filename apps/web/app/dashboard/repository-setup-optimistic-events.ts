import type {
  ProviderAuthMode,
  ProviderKind,
} from "@reviewrouter/features-review-providers";

export const providerSetupConfirmedEventName =
  "reviewrouter:provider-setup-confirmed";
export const setupPullRequestMergedEventName =
  "reviewrouter:setup-pull-request-merged";

export type ProviderSetupConfirmedEventDetail = {
  readonly repositoryId: string;
  readonly repositoryFullName: string;
  readonly providerKind?: ProviderKind;
  readonly authMode?: ProviderAuthMode;
};

export type SetupPullRequestMergedEventDetail = {
  readonly repositoryId: string;
};

export function providerSetupConfirmedEvent(
  detail: ProviderSetupConfirmedEventDetail,
): CustomEvent<ProviderSetupConfirmedEventDetail> {
  return new CustomEvent(providerSetupConfirmedEventName, { detail });
}

export function setupPullRequestMergedEvent(
  detail: SetupPullRequestMergedEventDetail,
): CustomEvent<SetupPullRequestMergedEventDetail> {
  return new CustomEvent(setupPullRequestMergedEventName, { detail });
}

let refreshed = false;

/**
 * One server refresh for the setup events sent together (in one synchronous
 * run, until the next microtask). Every repository row listens to them, and a
 * second `router.refresh()` in that run after the repository search rewrote
 * the URL makes the Next router reload the whole document, which closes open
 * rows and dialogs. Each event is sent after its change was saved, so the one
 * refresh already sees all of them.
 */
export function refreshAfterSetupEvent(router: { refresh(): void }): void {
  if (refreshed) return;
  refreshed = true;
  queueMicrotask(() => {
    refreshed = false;
  });
  router.refresh();
}
