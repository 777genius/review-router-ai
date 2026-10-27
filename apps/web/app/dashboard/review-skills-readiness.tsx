import Link from "next/link";
import type { RepositorySkillsReadiness } from "../../src/features/review-skills/contracts";

export function skillsReadinessMessage(value: RepositorySkillsReadiness) {
  switch (value.reason) {
    case "supported":
      return "Configured runtime supports Skills.";
    case "unsupported_workflow":
      return "This workflow does not support Skills. Update the repository setup.";
    case "engine_unsupported":
      return "The configured review engine does not support Skills. Choose a supporting engine.";
    case "engine_unavailable":
      return "The configured review engine is unavailable. Check repository configuration.";
    case "configuration_required":
      return "Save a review configuration before using Skills.";
    case "configuration_resave_required":
      return "Save the review configuration again to enable Skills.";
    case "workflow_update_required":
      return "Update the repository workflow to use Skills.";
    case "workflow_unconfirmed":
      return "Workflow support is not confirmed. Check repository setup.";
    case "runtime_unconfirmed":
      return "Configured runtime support is not confirmed. Check repository configuration.";
  }
}

const readinessLabels: Record<RepositorySkillsReadiness["reason"], string> = {
  supported: "Runtime supports Skills",
  unsupported_workflow: "Workflow unsupported",
  engine_unsupported: "Engine unsupported",
  engine_unavailable: "Engine unavailable",
  configuration_required: "Configuration required",
  configuration_resave_required: "Configuration needs saving",
  workflow_update_required: "Workflow update required",
  workflow_unconfirmed: "Workflow unconfirmed",
  runtime_unconfirmed: "Runtime unconfirmed",
};

export function skillsReadinessLabel(value: RepositorySkillsReadiness) {
  return readinessLabels[value.reason];
}

export function SkillsReadiness({
  values,
  workspaceId,
  loading = false,
}: {
  readonly values: readonly RepositorySkillsReadiness[] | undefined;
  readonly workspaceId: string;
  readonly loading?: boolean;
}) {
  if (!values?.length)
    return (
      <p role="status" className="text-xs leading-5 text-slate-400">
        {loading
          ? "Checking configured runtime support…"
          : "Configured runtime support is not confirmed. Check repository configuration before running a review."}
      </p>
    );
  const ready = values.filter((value) => value.status === "ready").length;
  const blocked = values.filter((value) => value.status === "blocked").length;
  const uncertain = values.length - ready - blocked;
  const needsSetup = ready !== values.length;
  return (
    <div className="space-y-2 text-xs leading-5 text-slate-400">
      <p>
        {values.length === 1
          ? skillsReadinessMessage(values[0]!)
          : `${ready}/${values.length} configured runtimes support Skills${blocked ? ` · ${blocked} ${blocked === 1 ? "needs" : "need"} setup changes` : ""}${uncertain ? ` · ${uncertain} unconfirmed` : ""}.`}{" "}
        {needsSetup
          ? "You can save assignments, but reviews need a supporting runtime."
          : "Support is checked again when a review starts."}
      </p>
      {values.length > 1 && needsSetup ? (
        <details>
          <summary className="cursor-pointer">
            Show repositories needing attention
          </summary>
          <ul className="mt-2 space-y-2">
            {values
              .filter((value) => value.status !== "ready")
              .map((value) => (
                <li key={value.repositoryId} className="break-words">
                  <span className="font-medium text-slate-300">
                    {value.name}
                  </span>
                  : {skillsReadinessMessage(value)}
                </li>
              ))}
          </ul>
        </details>
      ) : null}
      {needsSetup ? (
        <Link
          className="inline-block text-cyan-200 underline underline-offset-4"
          href={`/dashboard?section=repositories&workspace=${encodeURIComponent(workspaceId)}`}
        >
          Review repository setup
        </Link>
      ) : null}
    </div>
  );
}
