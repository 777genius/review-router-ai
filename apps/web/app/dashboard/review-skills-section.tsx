import { loadReviewSkillsDashboard } from "../../src/server/review-skills-dashboard";
import { ReviewSkillsLibrary } from "./review-skills-library";
export async function ReviewSkillsSection({
  workspaceId,
  workspaceKey,
  initialSkillId = "",
}: {
  readonly workspaceId: string;
  readonly workspaceKey: string;
  readonly initialSkillId?: string;
}) {
  const bootstrap = await loadReviewSkillsDashboard(workspaceId);
  return (
    <section
      id="dashboard-section-content"
      aria-labelledby="review-skills-title"
      className="min-w-0 space-y-5 px-1 py-5"
    >
      <div className="border-b border-cyan-200/15 pb-5">
        <p className="font-mono text-xs uppercase tracking-[0.16em] text-cyan-200">
          Review instructions
        </p>
        <h2
          id="review-skills-title"
          className="mt-2 text-3xl font-bold text-cyan-50"
        >
          Skills
        </h2>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-400">
          Write review instructions once, share them across workspaces, and
          choose which repositories use them.
        </p>
        <p className="mt-3 break-all text-xs text-slate-500">
          Workspace ID: <code>{workspaceId}</code>
        </p>
      </div>
      {bootstrap.status === "ok" ? (
        <ReviewSkillsLibrary
          key={`${bootstrap.viewerId}:${workspaceId}`}
          workspaceId={workspaceId}
          workspaceKey={workspaceKey}
          viewerId={bootstrap.viewerId}
          capabilities={bootstrap.capabilities}
          initialPage={bootstrap.page}
          initialSkillId={initialSkillId}
        />
      ) : (
        <p role="status" className="text-sm leading-6 text-slate-300">
          {bootstrap.status === "restricted"
            ? "Workspace membership is required to read or create library content. With repository-manager access, use Repositories → select repositories → Manage skills to add or remove available instructions."
            : bootstrap.status === "signed_out"
              ? "Sign in to view the workspace Skills library."
              : "The Skills library is temporarily unavailable. Refresh this page to try again."}
        </p>
      )}
    </section>
  );
}
