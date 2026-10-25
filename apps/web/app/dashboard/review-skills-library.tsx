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
} from "../../src/features/review-skills/contracts";
import { requestReviewSkills } from "../../src/features/review-skills/client-adapter";
import { reviewSkillsKeys } from "../../src/features/review-skills/query-keys";
import { SkillEditorDialog } from "./skill-editor-dialog";
import {
  AddWorkspaceSkillDialog,
  SkillAccessDialog,
} from "./skill-access-dialog";
import { RepositorySkillsOperation } from "./repository-skills-dialog";
import {
  SkillsDialog,
  SkillsError,
  SkillSearch,
  skillCellClass,
  skillMobileLabelClass,
  skillResponsiveCellClass,
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
                      {skill.available ? "Repositories" : "Remove assignments"}
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
          canCreate={capabilities.canCreate}
          onClose={() => setRepositories(null)}
        />
      ) : null}
    </>
  );
}
function SkillRepositoriesDialog({
  workspaceId,
  viewerId,
  skill,
  canCreate,
  onClose,
}: {
  readonly workspaceId: string;
  readonly viewerId: string;
  readonly skill: RepositorySkill;
  readonly canCreate: boolean;
  readonly onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<ReadonlyMap<string, boolean>>(
    () => new Map(),
  );
  const [captured, setCaptured] = useState<{
    readonly repositoryIds: readonly string[];
    readonly removalOnly: boolean;
  } | null>(null);
  const selectedInactive = [...selected.values()].some((active) => !active);
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
  if (captured)
    return (
      <RepositorySkillsOperation
        workspaceId={workspaceId}
        viewerId={viewerId}
        repositoryIds={captured.repositoryIds}
        canCreate={canCreate}
        initialSkillIds={[skill.skillId]}
        initialMode={
          skill.available === false || captured.removalOnly ? "remove" : "add"
        }
        removalOnly={captured.removalOnly}
        initialSearch={Array.from(skill.name).slice(0, 100).join("")}
        onClose={onClose}
      />
    );
  return (
    <SkillsDialog
      open
      onClose={onClose}
      title={
        skill.available === false
          ? "Remove skill assignments"
          : "Assign skill to repositories"
      }
      description={
        skill.available === false
          ? `Choose assigned repositories to remove unavailable skill ${skill.skillId}. The original remains unchanged.`
          : `Choose repository targets for “${skill.name}”, then add or remove assignments. No existing assignments are preselected.`
      }
      footer={
        <Button
          type="button"
          disabled={selected.size === 0}
          onClick={() =>
            setCaptured({
              repositoryIds: [...selected.keys()],
              removalOnly: selectedInactive,
            })
          }
        >
          Manage selected repositories ({selected.size})
        </Button>
      }
    >
      <SkillSearch
        value={search}
        onChange={setSearch}
        label="Search repositories"
        placeholder="Owner or repository name"
      />
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
              className="flex cursor-pointer items-center gap-3 py-3 text-sm"
            >
              <Checkbox
                checked={selected.has(repo.repositoryId)}
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
                    else next.set(repo.repositoryId, repo.active);
                    return next;
                  })
                }
              />
              <span className="min-w-0 flex-1 break-all">{repo.name}</span>
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
          disabled={targets.isFetchingNextPage}
          onClick={() => {
            void targets.fetchNextPage();
          }}
        >
          Load more repositories
        </Button>
      ) : null}
    </SkillsDialog>
  );
}
