"use client";
import { useCallback, useState } from "react";
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
import type { ReviewSkillsInput } from "../../src/features/review-skills/contracts";
import { loadReviewSkillsClientContext } from "./review-skills-actions";
import { useRepositorySelection } from "./repository-action-selection";
import {
  SkillsDialog,
  SkillsError,
  SkillSearch,
  skillCellClass,
  skillFieldClass,
  skillMobileLabelClass,
  skillResponsiveCellClass,
} from "./review-skills-ui";
import { SkillEditorDialog } from "./skill-editor-dialog";
import { SkillsReadiness } from "./review-skills-readiness";
import {
  RepositorySkillSettings,
  SkillBindingPaths,
  skillBindingPathsDraftIsDirty,
  skillScopeSummary,
  type SkillBindingPathsDraft,
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
  initialMode = "add",
  initialSearch = "",
  removalOnly = false,
}: CapturedSelection & {
  readonly workspaceId: string;
  readonly onClose: () => void;
  readonly initialSkillIds?: readonly string[];
  readonly initialMode?: "add" | "remove";
  readonly initialSearch?: string;
  readonly removalOnly?: boolean;
}) {
  const singleRepository = repositoryIds.length === 1;
  const [view, setView] = useState<"assigned" | "picker">(
    singleRepository && initialSkillIds.length === 0 && !removalOnly
      ? "assigned"
      : "picker",
  );
  const assignedOnly = singleRepository && view === "assigned";
  const [mode, setMode] = useState<"add" | "remove">(
    removalOnly ? "remove" : initialMode,
  );
  const [search, setSearch] = useState(initialSearch);
  const [focusedSkillId, setFocusedSkillId] = useState<string | null>(() =>
    initialSkillIds.length === 1 ? initialSkillIds[0]! : null,
  );
  const effectiveSearch = focusedSkillId ?? search;
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set(initialSkillIds),
  );
  const [creating, setCreating] = useState(false);
  const [include, setInclude] = useState("**");
  const [exclude, setExclude] = useState("");
  const [success, setSuccess] = useState("");
  const [pathDrafts, setPathDrafts] = useState<
    ReadonlyMap<string, SkillBindingPathsDraft>
  >(() => new Map());
  const [nestedPending, setNestedPending] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const updatePathDraft = useCallback(
    (skillId: string, draft: SkillBindingPathsDraft) =>
      setPathDrafts((prior) => new Map(prior).set(skillId, draft)),
    [],
  );
  const updateNestedPending = useCallback((key: string, pending: boolean) => {
    setNestedPending((prior) => {
      if (prior.has(key) === pending) return prior;
      const next = new Set(prior);
      if (pending) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);
  const client = useQueryClient();
  const overLimit = repositoryIds.length > 1000;
  const choices = useInfiniteQuery({
    queryKey: reviewSkillsKeys.choices(
      viewerId,
      workspaceId,
      repositoryIds,
      effectiveSearch,
      assignedOnly,
    ),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      requestReviewSkills("listAssignmentChoices", {
        workspaceId,
        repositoryIds,
        search: effectiveSearch,
        assignedOnly,
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
    mutationFn: (command: ReviewSkillsInput<"applyAssignments">) =>
      requestReviewSkills("applyAssignments", command),
    onSuccess: async (result, command) => {
      setSuccess(
        `${result.added} added, ${result.removed} removed, ${result.unchanged} already in the requested state.`,
      );
      setSelected(new Set());
      if (command.mode === "remove")
        setPathDrafts((prior) => {
          const next = new Map(prior);
          for (const skillId of command.skillIds) next.delete(skillId);
          return next;
        });
      if (singleRepository && command.mode === "add") {
        setView("assigned");
        setSearch("");
        setFocusedSkillId(null);
      }
      await client.invalidateQueries({
        queryKey: reviewSkillsKeys.workspace(viewerId, workspaceId),
      });
    },
  });
  const completionUnknown =
    apply.error instanceof ReviewSkillsClientError &&
    apply.error.code === "unknown";
  const controlsLocked =
    apply.isPending || completionUnknown || nestedPending.size > 0;
  const dirtyPathCount = [...pathDrafts.values()].filter(
    skillBindingPathsDraftIsDirty,
  ).length;
  const close = () => {
    if (apply.isPending || nestedPending.size > 0) return;
    if (
      dirtyPathCount > 0 &&
      !window.confirm("Discard your unsaved skill path changes?")
    )
      return;
    onClose();
  };
  const acknowledgePathDraft = async (
    skillId: string,
    acknowledged: SkillBindingPathsDraft,
  ) => {
    const refreshed = await choices.refetch();
    if (!refreshed.isSuccess || skillBindingPathsDraftIsDirty(acknowledged))
      return;
    // Once query data includes the readback, clean forms resume using it.
    // A user edit during readback replaces this object and remains preserved.
    setPathDrafts((prior) => {
      if (prior.get(skillId) !== acknowledged) return prior;
      const next = new Map(prior);
      next.delete(skillId);
      return next;
    });
  };
  const toggle = (id: string) =>
    setSelected((prior) => {
      const next = new Set(prior);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const submit = (skillIds: readonly string[], operation: "add" | "remove") => {
    if (
      operation === "remove" &&
      skillIds.some((skillId) => {
        const draft = pathDrafts.get(skillId);
        return draft && skillBindingPathsDraftIsDirty(draft);
      }) &&
      !window.confirm(
        "Remove these skill assignments and discard their unsaved path changes?",
      )
    )
      return;
    setSuccess("");
    apply.mutate({
      workspaceId,
      repositoryIds,
      skillIds,
      mode: operation,
      ...(operation === "add"
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
    });
  };
  const changeView = (next: "assigned" | "picker") => {
    if (controlsLocked || creating) return;
    setView(next);
    setSearch("");
    setFocusedSkillId(null);
    setSelected(new Set());
    setMode("add");
    setSuccess("");
    apply.reset();
  };
  return (
    <SkillsDialog
      open
      onClose={close}
      pending={apply.isPending || nestedPending.size > 0}
      title={
        assignedOnly
          ? "Assigned skills"
          : mode === "add"
            ? "Add skills to repositories"
            : "Remove skills from repositories"
      }
      description={
        assignedOnly
          ? "Manage this repository's review instructions and file scopes. Changes affect future reviews."
          : `${repositoryIds.length} ${repositoryIds.length === 1 ? "repository" : "repositories"} selected. ${mode === "add" ? "Adds missing skills; other skills and existing path settings stay in place." : "Removes only the checked skills from these repositories."}`
      }
      feedback={
        <>
          {!overLimit && !assignedOnly ? (
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
          {selected.size > 100 ? (
            <p role="alert" className="text-sm text-amber-100">
              All {selected.size} checked skills are preserved. You can update
              up to 100 skills at once. Uncheck skills or clear the selection
              before applying.
            </p>
          ) : null}
          {dirtyPathCount > 0 ? (
            <p role="status" className="text-sm text-amber-100">
              Unsaved path changes for {dirtyPathCount}{" "}
              {dirtyPathCount === 1 ? "skill" : "skills"}. Search keeps these
              drafts. Use Save paths for each edited skill to apply them.
            </p>
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
        !assignedOnly || completionUnknown ? (
          <Button
            type="button"
            disabled={
              apply.isPending ||
              nestedPending.size > 0 ||
              (!completionUnknown && selected.size === 0) ||
              (!completionUnknown && selected.size > 100) ||
              overLimit ||
              (!completionUnknown && (selectedUnavailable || choices.isError))
            }
            onClick={() => {
              if (completionUnknown && apply.variables)
                apply.mutate(apply.variables);
              else submit([...selected], mode);
            }}
          >
            {apply.isPending
              ? "Applying…"
              : completionUnknown
                ? "Retry exact operation"
                : mode === "add"
                  ? singleRepository
                    ? `Add ${selected.size} ${selected.size === 1 ? "skill" : "skills"}`
                    : "Add selected skills"
                  : "Remove selected skills"}
          </Button>
        ) : undefined
      }
    >
      {removalOnly ? (
        <p role="status" className="text-sm text-amber-100">
          This selection includes inactive repositories. Only removing skill
          assignments is available.
        </p>
      ) : null}
      {!overLimit ? (
        <SkillsReadiness
          values={choices.data?.pages[0]?.repositoryReadiness}
          workspaceId={workspaceId}
          loading={choices.isPending}
        />
      ) : null}
      {singleRepository && !removalOnly ? (
        <Button
          type="button"
          variant="outline"
          disabled={controlsLocked || creating}
          onClick={() => changeView(assignedOnly ? "picker" : "assigned")}
        >
          {assignedOnly ? "Add skills" : "Back to assigned skills"}
        </Button>
      ) : null}
      {(!assignedOnly && !singleRepository) || removalOnly ? (
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
              disabled={controlsLocked || (removalOnly && value === "add")}
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
      ) : null}
      {overLimit ? (
        <p role="alert" className="text-amber-100">
          All {repositoryIds.length} selected repositories are preserved. You
          can update up to 1000 repositories at once. Close and narrow your
          search or selection; no changes have been submitted.
        </p>
      ) : (
        <>
          <SkillSearch
            value={search}
            disabled={controlsLocked}
            onChange={(value) => {
              setSearch(value);
              setFocusedSkillId(null);
            }}
          />
          {focusedSkillId ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-slate-400">
                Showing the chosen skill.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={controlsLocked}
                onClick={() => {
                  setFocusedSkillId(null);
                  setSearch("");
                }}
              >
                Show all skills
              </Button>
            </div>
          ) : null}
          {choices.isPending ? (
            <p role="status">
              {assignedOnly
                ? "Loading assigned skills…"
                : "Loading available skills…"}
            </p>
          ) : null}
          <SkillsError error={choices.error} />
          <div className="overflow-x-auto">
            <table
              role="table"
              className="block w-full border-collapse lg:table lg:min-w-[36rem]"
            >
              <caption className="sr-only">
                Skill operation choices; assigned counts cover all{" "}
                {repositoryIds.length} selected repositories.
              </caption>
              <thead role="rowgroup" className="hidden lg:table-header-group">
                <tr
                  role="row"
                  className="border-b border-cyan-200/20 text-slate-400"
                >
                  {!assignedOnly ? (
                    <th
                      role="columnheader"
                      scope="col"
                      className={skillCellClass}
                    >
                      Select
                    </th>
                  ) : null}
                  <th
                    role="columnheader"
                    scope="col"
                    className={skillCellClass}
                  >
                    Name and description
                  </th>
                  <th
                    role="columnheader"
                    scope="col"
                    className={skillCellClass}
                  >
                    Author / source
                  </th>
                  <th
                    role="columnheader"
                    scope="col"
                    className={skillCellClass}
                  >
                    {assignedOnly ? "Actions" : "Assigned"}
                  </th>
                </tr>
              </thead>
              <tbody role="rowgroup" className="block lg:table-row-group">
                {rows.map((row) => (
                  <tr
                    role="row"
                    key={row.skillId}
                    className="grid grid-cols-2 gap-x-4 border-b border-cyan-200/15 py-3 lg:table-row lg:border-cyan-200/10 lg:py-0"
                  >
                    {!assignedOnly ? (
                      <td
                        role="cell"
                        className={`${skillResponsiveCellClass} col-span-2`}
                      >
                        <span className={skillMobileLabelClass}>Select</span>
                        <Checkbox
                          aria-label={`Select skill ${row.name}${row.available ? "" : ` ${row.skillId}`}`}
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
                    ) : null}
                    <td
                      role="cell"
                      className={`${skillResponsiveCellClass} col-span-2`}
                    >
                      <p className="break-words font-semibold text-cyan-50">
                        {row.name}
                      </p>
                      {!row.available ? (
                        <code className="mt-1 block break-all text-xs text-slate-500">
                          {row.skillId}
                        </code>
                      ) : null}
                      <p className="mt-1 max-w-sm break-words text-slate-400">
                        {row.available
                          ? row.description
                          : "Unavailable — remove assignments to allow new reviews."}
                      </p>
                      {assignedOnly &&
                      !removalOnly &&
                      row.available &&
                      row.bindings[0] ? (
                        <>
                          <p className="my-2 break-words text-xs text-slate-400">
                            Applies to:{" "}
                            {skillScopeSummary(row.bindings[0].scope)}
                          </p>
                          <SkillBindingPaths
                            key={row.skillId}
                            workspaceId={workspaceId}
                            viewerId={viewerId}
                            repositoryId={repositoryIds[0]!}
                            binding={row.bindings[0]}
                            {...(pathDrafts.has(row.skillId)
                              ? { draft: pathDrafts.get(row.skillId)! }
                              : {})}
                            locked={controlsLocked}
                            onDraftChange={updatePathDraft}
                            onPendingChange={updateNestedPending}
                            onSaved={acknowledgePathDraft}
                          />
                        </>
                      ) : null}
                    </td>
                    <td
                      role="cell"
                      className={`${skillResponsiveCellClass} break-words text-slate-400`}
                    >
                      <span className={skillMobileLabelClass}>
                        Author / source
                      </span>
                      {row.authorName ?? "—"}
                      <br />
                      {row.sourceWorkspaceName ?? "Unavailable source"}
                    </td>
                    <td
                      role="cell"
                      className={`${skillResponsiveCellClass} text-cyan-100`}
                    >
                      <span className={skillMobileLabelClass}>
                        {assignedOnly ? "Actions" : "Assigned"}
                      </span>
                      {assignedOnly ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-label={`Remove skill ${row.name}${row.available ? "" : ` ${row.skillId}`}`}
                          disabled={controlsLocked}
                          onClick={() => submit([row.skillId], "remove")}
                        >
                          Remove
                        </Button>
                      ) : (
                        `${row.assignedCount}/${row.repositoryCount}`
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length === 0 && !choices.isPending && !choices.isError ? (
            <p className="text-sm text-slate-400">
              {choices.isFetching || apply.isPending
                ? "Refreshing skills…"
                : assignedOnly
                  ? "No matching assigned skills. Add skills from the library or enable Skills from this repository."
                  : canCreate
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
          {!assignedOnly && canCreate && mode === "add" ? (
            <Button
              type="button"
              variant="outline"
              disabled={controlsLocked}
              onClick={() => setCreating(true)}
            >
              Create skill
            </Button>
          ) : null}
          {!assignedOnly && mode === "add" ? (
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
          {assignedOnly && !removalOnly ? (
            <RepositorySkillSettings
              workspaceId={workspaceId}
              viewerId={viewerId}
              repositoryId={repositoryIds[0]!}
              locked={controlsLocked}
              onPendingChange={updateNestedPending}
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
            setSearch(Array.from(document.name).slice(0, 100).join(""));
            setFocusedSkillId(document.skillId);
            setSuccess("");
            apply.reset();
            void client.invalidateQueries({
              queryKey: reviewSkillsKeys.workspace(viewerId, workspaceId),
            });
          }}
        />
      ) : null}
    </SkillsDialog>
  );
}
