"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { Button, Checkbox } from "@reviewrouter/ui";
import { ActionToast } from "../action-toast";
import type {
  ReviewSkillCapabilities,
  ReviewSkillDocument,
  ReviewSkillLibraryEntry,
  ReviewSkillSummary,
  ReviewSkillsPage,
  ReviewSkillRepositoryTarget,
  RepositorySkillsReadiness,
  ReviewSkillsInput,
} from "../../src/features/review-skills/contracts";
import {
  requestReviewSkills,
  ReviewSkillsClientError,
} from "../../src/features/review-skills/client-adapter";
import { reviewSkillsKeys } from "../../src/features/review-skills/query-keys";
import { SkillEditorDialog } from "./skill-editor-dialog";
import {
  AddWorkspaceSkillDialog,
  SkillAccessDialog,
} from "./skill-access-dialog";
import {
  SkillsReadiness,
  skillsReadinessLabel,
} from "./review-skills-readiness";
import {
  SkillsDialog,
  SkillsError,
  SkillSearch,
  skillCellClass,
  skillMobileLabelClass,
  skillResponsiveCellClass,
  skillFieldClass,
} from "./review-skills-ui";

type RepositorySkill = Pick<ReviewSkillSummary, "skillId" | "name"> & {
  readonly available?: boolean;
};

export function ReviewSkillsLibrary({
  workspaceId,
  viewerId,
  initialPage,
  capabilities,
  initialSkillId,
}: {
  readonly workspaceId: string;
  readonly workspaceKey: string;
  readonly viewerId: string;
  readonly initialPage: ReviewSkillsPage<ReviewSkillLibraryEntry>;
  readonly capabilities: ReviewSkillCapabilities;
  readonly initialSkillId: string;
}) {
  const [search, setSearch] = useState("");
  const [editor, setEditor] = useState<ReviewSkillDocument | "create" | null>(
    null,
  );
  const [linking, setLinking] = useState(false);
  const [access, setAccess] = useState<ReviewSkillSummary | null>(null);
  const [repositories, setRepositories] = useState<RepositorySkill | null>(
    null,
  );
  const [error, setError] = useState<unknown>(null);
  const [savedRevisionId, setSavedRevisionId] = useState("");
  const [openingSkillId, setOpeningSkillId] = useState<string | null>(null);
  const editorRequest = useRef(0);
  const client = useQueryClient();
  const library = useInfiniteQuery({
    queryKey: reviewSkillsKeys.library(viewerId, workspaceId, search),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      requestReviewSkills("listWorkspaceSkills", {
        workspaceId,
        search,
        cursor: pageParam,
      }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    ...(search === ""
      ? { initialData: { pages: [initialPage], pageParams: [null] } }
      : {}),
    staleTime: 15_000,
    retry: false,
  });
  const rows = library.data?.pages.flatMap((page) => page.items) ?? [];
  const invalidate = () =>
    client.invalidateQueries({
      queryKey: reviewSkillsKeys.workspace(viewerId, workspaceId),
    });
  const open = useCallback(
    async (skillId: string) => {
      const request = ++editorRequest.current;
      setOpeningSkillId(skillId);
      setError(null);
      try {
        const document = await requestReviewSkills("loadSkill", {
          workspaceId,
          skillId,
        });
        if (request === editorRequest.current) setEditor(document);
      } catch (cause) {
        if (request === editorRequest.current) setError(cause);
      } finally {
        if (request === editorRequest.current) setOpeningSkillId(null);
      }
    },
    [workspaceId],
  );
  const closeEditor = () => {
    ++editorRequest.current;
    setOpeningSkillId(null);
    setEditor(null);
  };
  const createEditor = () => {
    ++editorRequest.current;
    setOpeningSkillId(null);
    setError(null);
    setEditor("create");
  };
  useEffect(() => {
    if (initialSkillId) void open(initialSkillId);
    return () => {
      ++editorRequest.current;
    };
  }, [initialSkillId, open]);
  const remove = useMutation({
    mutationFn: (skill: ReviewSkillLibraryEntry) =>
      skill.linked
        ? requestReviewSkills("unlinkSkill", {
            destinationWorkspaceId: workspaceId,
            skillId: skill.skillId,
          })
        : requestReviewSkills("deleteSkill", {
            workspaceId,
            skillId: skill.skillId,
          }),
    onSuccess: invalidate,
  });
  return (
    <>
      {savedRevisionId ? (
        <ActionToast
          key={savedRevisionId}
          tone="success"
          title="Skill saved"
          body="Future reviews will use the updated instructions."
        />
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {capabilities.canCreate ? (
            <Button type="button" onClick={createEditor}>
              Create skill
            </Button>
          ) : null}
          {capabilities.canAdmin ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => setLinking(true)}
            >
              Add from workspace
            </Button>
          ) : null}
        </div>
        <p className="text-xs text-slate-500">
          Created here and shared from other workspaces
        </p>
      </div>
      <SkillSearch value={search} onChange={setSearch} />
      <SkillsError error={error ?? library.error ?? remove.error} />
      {openingSkillId ? <p role="status">Opening skill…</p> : null}
      {library.isPending ? <p role="status">Loading skills…</p> : null}
      <div className="overflow-x-auto">
        <table
          role="table"
          className="block w-full border-collapse lg:table lg:min-w-[48rem]"
        >
          <caption className="sr-only">Workspace review skills</caption>
          <thead role="rowgroup" className="hidden lg:table-header-group">
            <tr
              role="row"
              className="border-b border-cyan-200/20 text-slate-400"
            >
              <th role="columnheader" scope="col" className={skillCellClass}>
                Name / description
              </th>
              <th role="columnheader" scope="col" className={skillCellClass}>
                Author
              </th>
              <th role="columnheader" scope="col" className={skillCellClass}>
                Source
              </th>
              <th role="columnheader" scope="col" className={skillCellClass}>
                Used in this workspace
              </th>
              <th role="columnheader" scope="col" className={skillCellClass}>
                Actions
              </th>
            </tr>
          </thead>
          <tbody role="rowgroup" className="block lg:table-row-group">
            {rows.map((skill) => (
              <tr
                role="row"
                key={skill.skillId}
                className="grid grid-cols-2 gap-x-4 border-b border-cyan-200/15 py-3 lg:table-row lg:border-cyan-200/10 lg:py-0"
              >
                <td
                  role="cell"
                  className={`${skillResponsiveCellClass} col-span-2`}
                >
                  {skill.available ? (
                    <>
                      <button
                        type="button"
                        className="max-w-full break-words text-left font-semibold text-cyan-100 underline-offset-4 hover:underline"
                        aria-busy={openingSkillId === skill.skillId}
                        onClick={() => {
                          void open(skill.skillId);
                        }}
                      >
                        {skill.name}
                      </button>
                      <p className="mt-1 max-w-sm whitespace-pre-wrap break-words text-slate-400">
                        {skill.description}
                      </p>
                      <p className="mt-2 text-xs text-slate-500">
                        Updated {new Date(skill.updatedAt).toLocaleDateString()}
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="font-semibold text-amber-100">
                        {skill.name}
                      </p>
                      <p className="mt-1 max-w-sm text-slate-400">
                        Access to the original is unavailable. Remove its
                        repository assignments, then remove this workspace link.
                      </p>
                      <code className="mt-2 block break-all text-xs text-slate-500">
                        {skill.skillId}
                      </code>
                    </>
                  )}
                </td>
                <td
                  role="cell"
                  className={`${skillResponsiveCellClass} break-words text-slate-300`}
                >
                  <span className={skillMobileLabelClass}>Author</span>
                  {skill.available ? skill.authorName : "—"}
                </td>
                <td
                  role="cell"
                  className={`${skillResponsiveCellClass} break-words text-slate-400`}
                >
                  <span className={skillMobileLabelClass}>Source</span>
                  {skill.available
                    ? skill.sourceWorkspaceName
                    : "Unavailable source"}
                  <span className="mt-1 block text-xs">
                    {skill.available
                      ? skill.linked
                        ? "Live link"
                        : "Original"
                      : "Link unavailable"}
                  </span>
                </td>
                <td
                  role="cell"
                  className={`${skillResponsiveCellClass} col-span-2 text-slate-400`}
                >
                  <span className={skillMobileLabelClass}>
                    Used in this workspace
                  </span>
                  {capabilities.canAdmin ? (
                    <>
                      <span>
                        {skill.usedIn.length}{" "}
                        {skill.usedIn.length === 1
                          ? "repository"
                          : "repositories"}
                      </span>
                      {skill.usedIn.length ? (
                        <details className="mt-1">
                          <summary className="cursor-pointer text-xs">
                            Show repositories
                          </summary>
                          <ul className="mt-2 space-y-1">
                            {skill.usedIn.map((repo) => (
                              <li key={repo.repositoryId}>{repo.name}</li>
                            ))}
                          </ul>
                        </details>
                      ) : null}
                    </>
                  ) : (
                    <span>Workspace admins can see repository usage.</span>
                  )}
                </td>
                <td
                  role="cell"
                  className={`${skillResponsiveCellClass} col-span-2`}
                >
                  <span className={skillMobileLabelClass}>Actions</span>
                  <div className="flex flex-wrap gap-2">
                    {skill.available && skill.capabilities.canEdit ? (
                      skill.linked ? (
                        <Link
                          className="text-sm text-cyan-200 underline"
                          href={`/dashboard?section=skills&workspace=${encodeURIComponent(skill.sourceWorkspaceId)}&skill=${encodeURIComponent(skill.skillId)}`}
                        >
                          Edit original
                        </Link>
                      ) : (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            void open(skill.skillId);
                          }}
                        >
                          Edit
                        </Button>
                      )
                    ) : null}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setRepositories(skill)}
                    >
                      {skill.available
                        ? "Assign to repositories"
                        : "Remove assignments"}
                    </Button>
                    {skill.available &&
                    skill.capabilities.canGrant &&
                    !skill.linked ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setAccess(skill)}
                      >
                        Manage access
                      </Button>
                    ) : null}
                    {(
                      skill.available
                        ? skill.linked
                          ? capabilities.canAdmin
                          : skill.capabilities.canDelete
                        : skill.canUnlink
                    ) ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={remove.isPending}
                        onClick={() => {
                          if (
                            window.confirm(
                              skill.linked
                                ? "Remove this link from the workspace? Repository assignments must be removed first."
                                : "Delete this original? Repository assignments and active grants must be removed first.",
                            )
                          )
                            remove.mutate(skill);
                        }}
                      >
                        {skill.linked
                          ? "Remove from workspace"
                          : "Delete original"}
                      </Button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && !library.isPending && !library.isError ? (
        <div className="py-8 text-center">
          <h3 className="text-lg font-semibold text-cyan-50">
            {search ? "No matching skills" : "No skills yet"}
          </h3>
          <p className="mt-3 text-sm text-slate-400">
            Create instructions here or link an original shared by another
            workspace, then assign it to repositories.
          </p>
        </div>
      ) : null}
      {library.hasNextPage ? (
        <Button
          type="button"
          variant="outline"
          disabled={library.isFetchingNextPage}
          onClick={() => {
            void library.fetchNextPage();
          }}
        >
          Load more skills
        </Button>
      ) : null}
      {editor ? (
        <SkillEditorDialog
          key={editor === "create" ? "create" : editor.revisionId}
          workspaceId={workspaceId}
          {...(editor === "create" ? {} : { document: editor })}
          onClose={closeEditor}
          onSaved={(document) => {
            closeEditor();
            if (editor === "create") setRepositories(document);
            else setSavedRevisionId(document.revisionId);
            void invalidate();
            if (document.sourceWorkspaceId !== workspaceId)
              void client.invalidateQueries({
                queryKey: reviewSkillsKeys.workspace(
                  viewerId,
                  document.sourceWorkspaceId,
                ),
              });
          }}
        />
      ) : null}
      {linking ? (
        <AddWorkspaceSkillDialog
          workspaceId={workspaceId}
          viewerId={viewerId}
          onClose={() => setLinking(false)}
          onAssign={(skill) => {
            setLinking(false);
            setRepositories(skill);
          }}
        />
      ) : null}
      {access ? (
        <SkillAccessDialog
          workspaceId={workspaceId}
          viewerId={viewerId}
          skill={access}
          onClose={() => setAccess(null)}
        />
      ) : null}
      {repositories ? (
        <SkillRepositoriesDialog
          workspaceId={workspaceId}
          viewerId={viewerId}
          skill={repositories}
          onClose={() => setRepositories(null)}
        />
      ) : null}
    </>
  );
}
type RepositoryTarget = ReviewSkillRepositoryTarget & {
  readonly readiness: RepositorySkillsReadiness;
};

function SkillRepositoriesDialog({
  workspaceId,
  viewerId,
  skill,
  onClose,
}: {
  readonly workspaceId: string;
  readonly viewerId: string;
  readonly skill: RepositorySkill;
  readonly onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<
    ReadonlyMap<string, RepositoryTarget>
  >(() => new Map());
  const [mode, setMode] = useState<"add" | "remove">(
    skill.available === false ? "remove" : "add",
  );
  const [include, setInclude] = useState("**");
  const [exclude, setExclude] = useState("");
  const [success, setSuccess] = useState("");
  const searchInput = useRef<HTMLInputElement>(null);
  const client = useQueryClient();
  const selectedInactive = [...selected.values()].some((repo) => !repo.active);
  const removalOnly = skill.available === false || selectedInactive;
  const effectiveMode = removalOnly ? "remove" : mode;
  const overLimit = selected.size > 1000;
  const targets = useInfiniteQuery({
    queryKey: [
      ...reviewSkillsKeys.workspace(viewerId, workspaceId),
      "targets",
      skill.skillId,
      search,
    ],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      requestReviewSkills("listSkillRepositoryTargets", {
        workspaceId,
        skillId: skill.skillId,
        search,
        cursor: pageParam,
      }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    staleTime: 10_000,
    retry: false,
  });
  const apply = useMutation({
    mutationFn: (command: ReviewSkillsInput<"applyAssignments">) =>
      requestReviewSkills("applyAssignments", command),
    onSuccess: async (result) => {
      setSuccess(
        `${result.added} added, ${result.removed} removed, ${result.unchanged} already in the requested state.`,
      );
      setSelected(new Map());
      await client.invalidateQueries({
        queryKey: reviewSkillsKeys.workspace(viewerId, workspaceId),
      });
    },
  });
  const completionUnknown =
    apply.error instanceof ReviewSkillsClientError &&
    apply.error.code === "unknown";
  const locked = apply.isPending || completionUnknown;
  const submit = () => {
    setSuccess("");
    if (completionUnknown && apply.variables) {
      apply.mutate(apply.variables);
      return;
    }
    apply.mutate({
      workspaceId,
      repositoryIds: [...selected.keys()],
      skillIds: [skill.skillId],
      mode: effectiveMode,
      ...(effectiveMode === "add"
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
  return (
    <SkillsDialog
      open
      onClose={onClose}
      initialFocus={searchInput}
      pending={apply.isPending}
      title={
        effectiveMode === "remove"
          ? "Remove skill assignments"
          : "Assign skill to repositories"
      }
      description={
        skill.available === false
          ? `Choose assigned repositories to remove unavailable skill ${skill.skillId}. The original remains unchanged.`
          : `Choose repositories for “${skill.name}”. Adding preserves existing assignments and their file scopes. No existing assignments are preselected.`
      }
      feedback={
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p aria-live="polite" className="text-xs text-slate-400">
              {selected.size} repositories checked. Search keeps checked
              repositories.
            </p>
            {selected.size > 0 ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={locked}
                onClick={() => setSelected(new Map())}
              >
                Clear checked repositories
              </Button>
            ) : null}
          </div>
          {overLimit ? (
            <p role="alert" className="text-sm text-amber-100">
              All {selected.size} checked repositories are preserved. You can
              update up to 1000 repositories at once. Uncheck repositories
              before applying; no changes have been submitted.
            </p>
          ) : null}
          <SkillsError error={apply.error} />
          {apply.isError ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={targets.isFetching}
              onClick={() => {
                void targets.refetch();
              }}
            >
              Refresh repository assignments
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
            (!completionUnknown &&
              (selected.size === 0 || overLimit || targets.isError))
          }
          onClick={submit}
        >
          {apply.isPending
            ? "Applying…"
            : completionUnknown
              ? "Retry exact operation"
              : effectiveMode === "add"
                ? `Assign to ${selected.size} ${selected.size === 1 ? "repository" : "repositories"}`
                : `Remove from ${selected.size} ${selected.size === 1 ? "repository" : "repositories"}`}
        </Button>
      }
    >
      <div
        role="group"
        aria-label="Skill assignment operation"
        className="flex flex-wrap gap-2"
      >
        {(["add", "remove"] as const).map((value) => (
          <Button
            key={value}
            type="button"
            variant={effectiveMode === value ? "solid" : "outline"}
            disabled={locked || (removalOnly && value === "add")}
            aria-pressed={effectiveMode === value}
            onClick={() => {
              setMode(value);
              setSuccess("");
              apply.reset();
            }}
          >
            {value === "add" ? "Add" : "Remove"}
          </Button>
        ))}
      </div>
      <SkillSearch
        value={search}
        onChange={setSearch}
        disabled={locked}
        inputRef={searchInput}
        label="Search repositories"
        placeholder="Owner or repository name"
      />
      {selected.size > 0 ? (
        <SkillsReadiness
          values={[...selected.values()].map((repo) => repo.readiness)}
          workspaceId={workspaceId}
        />
      ) : (
        <p className="text-xs text-slate-400">
          Choose repositories to see configured runtime support.
        </p>
      )}
      <SkillsError error={targets.error} />
      {selectedInactive ? (
        <p role="status" className="text-sm text-amber-100">
          This selection includes inactive repositories. Only removing skill
          assignments is available.
        </p>
      ) : null}
      {targets.isPending ? <p role="status">Loading repositories…</p> : null}
      {!targets.isPending &&
      !targets.isError &&
      targets.data?.pages.every((page) => page.items.length === 0) ? (
        <p className="text-sm text-slate-400">
          {skill.available === false
            ? "No matching assigned repositories are available. Clear the search to check the remaining assignments, or close and remove the workspace link once all assignments are cleared."
            : "No matching repositories are available. Change the search or check your repository access."}
        </p>
      ) : null}
      <div className="divide-y divide-cyan-200/10">
        {targets.data?.pages
          .flatMap((page) => page.items)
          .map((repo) => (
            <label
              key={repo.repositoryId}
              className="flex cursor-pointer items-start gap-3 py-3 text-sm"
            >
              <Checkbox
                checked={selected.has(repo.repositoryId)}
                disabled={locked}
                aria-label={`Select ${repo.name}`}
                aria-description={
                  repo.active
                    ? undefined
                    : "Inactive repository. Assignments can only be removed."
                }
                onChange={() =>
                  setSelected((prior) => {
                    const next = new Map(prior);
                    if (next.has(repo.repositoryId))
                      next.delete(repo.repositoryId);
                    else next.set(repo.repositoryId, repo);
                    return next;
                  })
                }
              />
              <span className="min-w-0 flex-1">
                <span className="block break-words">{repo.name}</span>
                {repo.readiness.status !== "ready" ? (
                  <span className="mt-1 block text-xs leading-5 text-slate-400">
                    {skillsReadinessLabel(repo.readiness)}
                  </span>
                ) : null}
              </span>
              <span className="text-xs text-slate-400">
                {repo.active
                  ? repo.assigned
                    ? "Assigned"
                    : "Not assigned"
                  : "Inactive · remove assignments only"}
              </span>
            </label>
          ))}
      </div>
      {targets.hasNextPage ? (
        <Button
          type="button"
          variant="outline"
          disabled={targets.isFetchingNextPage || locked}
          onClick={() => {
            void targets.fetchNextPage();
          }}
        >
          Load more repositories
        </Button>
      ) : null}
      {effectiveMode === "add" ? (
        <details className="border-t border-cyan-200/15 pt-3">
          <summary className="cursor-pointer text-sm text-slate-300">
            File scope for new assignments
          </summary>
          <p className="my-3 text-xs text-slate-400">
            Existing scopes are preserved. One repository-relative POSIX glob
            per line.
          </p>
          <label className="block text-sm">
            Include paths
            <textarea
              className={`${skillFieldClass} my-2 font-mono`}
              disabled={locked}
              value={include}
              onChange={(event) => setInclude(event.target.value)}
              rows={2}
            />
          </label>
          <label className="block text-sm">
            Exclude paths
            <textarea
              className={`${skillFieldClass} my-2 font-mono`}
              disabled={locked}
              value={exclude}
              onChange={(event) => setExclude(event.target.value)}
              rows={2}
            />
          </label>
        </details>
      ) : null}
    </SkillsDialog>
  );
}
