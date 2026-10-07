import { Button, type ButtonProps } from "@reviewrouter/ui";
import { SourceProviderLabel } from "./source-provider-logo";

export const gitLabBetaUnavailableLabel =
  "GitLab setup is in development and not available yet.";

export function GitLabBetaConnectButton({
  label = "Connect GitLab",
  size = "md",
  variant = "outline",
  className = "",
  labelClassName,
}: {
  readonly label?: string;
  readonly size?: ButtonProps["size"];
  readonly variant?: ButtonProps["variant"];
  readonly className?: string;
  readonly labelClassName?: string;
}): React.ReactElement {
  return (
    <span
      className={`gitlab-beta-cta${className.includes("w-full") ? " gitlab-beta-cta--stretch" : ""}`}
    >
      <Button
        type="button"
        disabled
        size={size}
        variant={variant}
        className={`disabled:opacity-100 ${className}`.trim()}
        title={gitLabBetaUnavailableLabel}
        aria-label={`${label} (In development, unavailable)`}
      >
        <SourceProviderLabel
          provider="gitlab"
          label={label}
          {...(labelClassName === undefined
            ? {}
            : { className: labelClassName })}
        />
      </Button>
      <span className="gitlab-beta-cta__ribbon" aria-hidden="true">
        In development
      </span>
    </span>
  );
}
