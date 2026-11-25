import { accountsCopy } from "./accounts-copy";
import { dashboardSectionHref } from "./dashboard-section";

/**
 * A usable connection is picked for reviews in Review providers. Review
 * settings only shows the current default, so links never stop there.
 */
export function ChooseForReviewsLink({
  workspaceId,
}: {
  workspaceId: string | undefined;
}): React.ReactElement {
  return (
    <a
      className="text-sm text-cyan-200 underline"
      href={dashboardSectionHref("providers", workspaceId)}
    >
      {accountsCopy.chooseForReviews}
    </a>
  );
}
