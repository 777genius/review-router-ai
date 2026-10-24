"use client";
import { useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { Button, Checkbox } from "@reviewrouter/ui";
import {
  requestReviewSkills,
  ReviewSkillsClientError,
} from "../../src/features/review-skills/client-adapter";
import { reviewSkillsKeys } from "../../src/features/review-skills/query-keys";
import { loadReviewSkillsClientContext } from "./review-skills-actions";
import { useRepositorySelection } from "./repository-action-selection";
import {
  SkillsDialog,
  SkillsError,
  SkillSearch,
  skillCellClass,
  skillFieldClass,
} from "./review-skills-ui";
import { SkillEditorDialog } from "./skill-editor-dialog";
import {
  RepositorySkillSettings,
  SkillBindingPaths,
} from "./repository-skill-settings";

type CapturedSelection = {
  readonly viewerId: string;
  readonly repositoryIds: readonly string[];
  readonly canCreate: boolean;
};
export function RepositorySkillsDialog({
  workspaceId,
}: {
  readonly workspaceId: string;
}) {
  const selection = useRepositorySelection();
  const [captured, setCaptured] = useState<CapturedSelection | null>(null);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function open() {
    if (!selection?.ids.length) return;
    const repositoryIds = [...selection.ids];
    setOpening(true);
    setError(null);
    try {
      const context = await loadReviewSkillsClientContext(workspaceId);
      setCaptured({ ...context, repositoryIds });
    } catch (cause) {
      setError(cause);
    } finally {
      setOpening(false);
    }
  }
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={!selection?.ids.length || selection.locked || opening}
        onClick={() => {
          void open();
        }}
      >
        {opening ? "Opening…" : "Manage skills"}
        {selection?.ids.length ? ` (${selection.ids.length})` : ""}
      </Button>
      <SkillsError error={error} />
      {captured ? (
        <RepositorySkillsOperation
          key={`${workspaceId}:${captured.repositoryIds.join(",")}`}
          workspaceId={workspaceId}
          {...captured}
          onClose={() => setCaptured(null)}
        />
      ) : null}
    </>
  );
}
export function RepositorySkillsOperation({
  workspaceId,
  viewerId,
  repositoryIds,
  canCreate,
  onClose,
  initialSkillIds = [],
}: CapturedSelection & {
  readonly workspaceId: string;
  readonly onClose: () => void;
  readonly initialSkillIds?: readonly string[];
}) {
  const [mode, setMode] = useState<"add" | "remove">("add");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set(initialSkillIds),
  );
  const [creating, setCreating] = useState(false);
  const [include, setInclude] = useState("**");
  const [exclude, setExclude] = useState("");
  const [success, setSuccess] = useState("");
  const client = useQueryClient();
  const overLimit = repositoryIds.length > 1000;
  const choices = useInfiniteQuery({
    queryKey: reviewSkillsKeys.choices(
      viewerId,
      workspaceId,
      repositoryIds,
      search,
    ),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      requestReviewSkills("listAssignmentChoices", {
        workspaceId,
        repositoryIds,
        search,
        cursor: pageParam,
      }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    staleTime: 10_000,
    enabled: !overLimit,
    retry: false,
  });
  const rows = choices.data?.pages.flatMap((page) => page.items) ?? [];
  const selectedUnavailable =
    mode === "add" &&
    rows.some((row) => selected.has(row.skillId) && !row.available);
  const apply = useMutation({
    mutationFn: () =>
      requestReviewSkills("applyAssignments", {
        workspaceId,
        repositoryIds,
        skillIds: [...selected],
        mode,
        ...(mode === "add"
          ? {
              scope: {
                includePaths: include
                  .split("\n")
                  .map((value) => value.trim())
                  .filter(Boolean),
                excludePaths: exclude
                  .split("\n")
                  .map((value) => value.trim())
                  .filter(Boolean),
              },
            }
          : {}),
      }),
    onSuccess: async (result) => {
      setSuccess(
        `${result.added} added, ${result.removed} removed, ${result.unchanged} already in the requested state.`,
      );
      setSelected(new Set());
      await client.invalidateQueries({
        queryKey: reviewSkillsKeys.workspace(viewerId, workspaceId),
      });
    },
  });
  const completionUnknown =
    apply.error instanceof ReviewSkillsClientError &&
    apply.error.code === "unknown";
  const controlsLocked = apply.isPending || completionUnknown;
  const toggle = (id: string) =>
    setSelected((prior) => {
      const next = new Set(prior);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <SkillsDialog
      open
      onClose={onClose}
      pending={apply.isPending}
      title={
        mode === "add"
          ? "Add skills to repositories"
          : "Remove skills from repositories"
      }
      description={`${repositoryIds.length} ${repositoryIds.length === 1 ? "repository" : "repositories"} selected. ${mode === "add" ? "Adds missing skills; other skills and existing path settings stay in place." : "Removes only the checked skills from these repositories."}`}
      feedback={
        <>
          {!overLimit ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p
                className="text-xs leading-5 text-slate-400"
                aria-live="polite"
              >
                {selected.size} skills checked for this {mode} operation.
                Changing search keeps checked skills.
              </p>
              {selected.size > 0 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={controlsLocked}
                  onClick={() => setSelected(new Set())}
                >
                  Clear checked skills
                </Button>
              ) : null}
            </div>
          ) : null}
          <SkillsError error={apply.error} />
          {apply.isError ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={choices.isFetching}
              onClick={() => {
                void choices.refetch();
              }}
            >
              Refresh assignment counts
            </Button>
          ) : null}
          {success ? (
            <p role="status" className="text-sm text-emerald-200">
              {success}
            </p>
          ) : null}
        </>
      }
      footer={
        <Button
          type="button"
          disabled={
            apply.isPending ||
            selected.size === 0 ||
            selected.size > 100 ||
            overLimit ||
            selectedUnavailable ||
            choices.isError
          }
          onClick={() => {
            setSuccess("");
            apply.mutate();
          }}
        >
          {apply.isPending
            ? "Applying…"
            : completionUnknown
              ? "Retry exact operation"
              : mode === "add"
                ? "Add selected skills"
                : "Remove selected skills"}
        </Button>
      }
    >
      <p className="text-xs leading-5 text-slate-400">
        Review Skills require a supporting ReviewRouter runtime. Reviews with
        unavailable skills or unsupported runtimes stop with an actionable
        error.
      </p>
      <div
        role="group"
        aria-label="Skills operation"
        className="flex flex-wrap gap-2"
      >
        {(["add", "remove"] as const).map((value) => (
          <Button
            key={value}
            type="button"
            variant={mode === value ? "solid" : "outline"}
            disabled={controlsLocked}
            aria-pressed={mode === value}
            onClick={() => {
              setMode(value);
              setSelected(new Set());
              setSuccess("");
              apply.reset();
            }}
          >
            {value === "add" ? "Add" : "Remove"}
          </Button>
        ))}
      </div>
      {overLimit ? (
        <p role="alert" className="text-amber-100">
          All {repositoryIds.length} selected repositories are preserved. You
          can update up to 1000 repositories at once. Close and narrow your
          search or selection; no changes have been submitted.
        </p>
      ) : (
        <>
          <SkillSearch value={search} onChange={setSearch} />
          {choices.isPending ? (
            <p role="status">Loading available skills…</p>
          ) : null}
          <SkillsError error={choices.error} />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] border-collapse">
              <caption className="sr-only">
                Skill operation choices; assigned counts cover all{" "}
                {repositoryIds.length} selected repositories.
              </caption>
              <thead>
                <tr className="border-b border-cyan-200/20 text-slate-400">
                  <th className={skillCellClass}>Select</th>
                  <th className={skillCellClass}>Name and description</th>
                  <th className={skillCellClass}>Author / source</th>
                  <th className={skillCellClass}>Assigned</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.skillId} className="border-b border-cyan-200/10">
                    <td className={skillCellClass}>
                      <Checkbox
                        aria-label={`Select skill ${row.name}`}
                        checked={selected.has(row.skillId)}
                        disabled={
                          controlsLocked ||
                          (mode === "add" &&
                            !row.available &&
                            !selected.has(row.skillId)) ||
                          (mode === "remove" &&
                            row.assignedCount === 0 &&
                            !selected.has(row.skillId))
                        }
                        onChange={() => toggle(row.skillId)}
                      />
                    </td>
                    <td className={skillCellClass}>
                      <p className="font-semibold text-cyan-50">{row.name}</p>
                      <p className="mt-1 max-w-sm text-slate-400">
                        {row.available
                          ? row.description
                          : "Unavailable — remove assignments to allow new reviews."}
                      </p>
                      {repositoryIds.length === 1 &&
                      row.available &&
                      row.bindings[0] ? (
                        <SkillBindingPaths
                          key={`${row.skillId}:${row.bindings[0].version}`}
                          workspaceId={workspaceId}
                          repositoryId={repositoryIds[0]!}
                          binding={row.bindings[0]}
                          onSaved={() => {
                            void choices.refetch();
                          }}
                        />
                      ) : null}
                    </td>
                    <td className={`${skillCellClass} text-slate-400`}>
                      {row.authorName ?? "—"}
                      <br />
                      {row.sourceWorkspaceName ?? "Unavailable source"}
                    </td>
                    <td
                      className={`${skillCellClass} whitespace-nowrap text-cyan-100`}
                    >
                      {row.assignedCount}/{row.repositoryCount}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length === 0 && !choices.isPending && !choices.isError ? (
            <p className="text-sm text-slate-400">
              {canCreate
                ? "No matching skills. Create one to add it to this repository selection."
                : "No matching skills are available. Ask a workspace member to create one, or an admin to link an available skill. Repository access does not allow creating or editing workspace content."}
            </p>
          ) : null}
          {choices.hasNextPage ? (
            <Button
              type="button"
              variant="outline"
              disabled={choices.isFetchingNextPage}
              onClick={() => {
                void choices.fetchNextPage();
              }}
            >
              Load more skills
            </Button>
          ) : null}
          {canCreate && mode === "add" ? (
            <Button
              type="button"
              variant="outline"
              disabled={controlsLocked}
              onClick={() => setCreating(true)}
            >
              Create skill
            </Button>
          ) : null}
          {mode === "add" ? (
            <details className="border-t border-cyan-200/15 pt-3">
              <summary className="cursor-pointer text-sm text-slate-300">
                Advanced: paths for new assignments
              </summary>
              <p className="my-3 text-xs text-slate-400">
                These scopes apply only to newly added assignments. Existing
                scopes are preserved. One POSIX glob per line.
              </p>
              <label className="block text-sm">
                Include paths
                <textarea
                  className={`${skillFieldClass} my-2 font-mono`}
                  disabled={controlsLocked}
                  value={include}
                  onChange={(event) => setInclude(event.target.value)}
                  rows={2}
                />
              </label>
              <label className="block text-sm">
                Exclude paths
                <textarea
                  className={`${skillFieldClass} my-2 font-mono`}
                  disabled={controlsLocked}
                  value={exclude}
                  onChange={(event) => setExclude(event.target.value)}
                  rows={2}
                />
              </label>
            </details>
          ) : null}
          {repositoryIds.length === 1 ? (
            <RepositorySkillSettings
              workspaceId={workspaceId}
              viewerId={viewerId}
              repositoryId={repositoryIds[0]!}
            />
          ) : null}
        </>
      )}
      {creating ? (
        <SkillEditorDialog
          workspaceId={workspaceId}
          onClose={() => setCreating(false)}
          onSaved={(document) => {
            setCreating(false);
            setSelected((prior) => new Set([...prior, document.skillId]));
            void choices.refetch();
          }}
        />
      ) : null}
    </SkillsDialog>
  );
}
