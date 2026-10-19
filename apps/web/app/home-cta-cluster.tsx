import { GitHubAppInstallPermissionDialog } from "./github-app-install-permission-dialog";
import { GitLabBetaConnectButton } from "./gitlab-beta-connect-button";
import { LoadingLinkButton } from "./loading-link-button";
import { SourceProviderLabel } from "./source-provider-logo";

export type HomeCtaClusterProps = {
  appInstallUrl: string | null;
  hasConnectedApp: boolean;
  githubHref: string;
  githubLabel: string;
  size?: "md" | "lg";
  className?: string;
};

export function HomeCtaCluster({
  appInstallUrl,
  hasConnectedApp,
  githubHref,
  githubLabel,
  size = "lg",
  className = "",
}: HomeCtaClusterProps): React.ReactElement {
  return (
    <div className={`flex flex-wrap items-center gap-3 ${className}`}>
      {!hasConnectedApp && appInstallUrl ? (
        <GitHubAppInstallPermissionDialog
          href={appInstallUrl}
          size={size}
          className="home-install-cta"
        >
          <SourceProviderLabel
            provider="github"
            label={githubLabel}
            className="relative z-10 inline-flex items-center gap-2"
          />
        </GitHubAppInstallPermissionDialog>
      ) : (
        <LoadingLinkButton
          href={githubHref}
          size={size}
          className="home-install-cta"
          pendingLabel={
            hasConnectedApp ? "Opening dashboard..." : "Opening setup..."
          }
        >
          <SourceProviderLabel
            provider="github"
            label={githubLabel}
            className="relative z-10 inline-flex items-center gap-2"
          />
        </LoadingLinkButton>
      )}
      <GitLabBetaConnectButton
        size={size}
        variant="solid"
        className="home-install-cta home-install-cta--gitlab"
        labelClassName="relative z-10 inline-flex items-center gap-2"
      />
    </div>
  );
}
