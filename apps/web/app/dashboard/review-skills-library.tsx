"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { Button, Checkbox } from "@reviewrouter/ui";
import type {
  ReviewSkillCapabilities,
  ReviewSkillDocument,
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
} from "./review-skills-ui";

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
  readonly initialPage: ReviewSkillsPage<ReviewSkillSummary>;
  readonly capabilities: ReviewSkillCapabilities;
  readonly initialSkillId: string;
}) {
  const [search, setSearch] = useState("");
  const [editor, setEditor] = useState<ReviewSkillDocument | "create" | null>(
    null,
  );
  const [linking, setLinking] = useState(false);
  const [access, setAccess] = useState<ReviewSkillSummary | null>(null);
  const [repositories, setRepositories] = useState<ReviewSkillSummary | null>(
    null,
  );
  const [error, setError] = useState<unknown>(null);
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
  const open = async (skillId: string) => {
    setError(null);
    try {
      setEditor(
        await requestReviewSkills("loadSkill", { workspaceId, skillId }),
      );
    } catch (cause) {
      setError(cause);
    }
  };
  useEffect(() => {
    if (initialSkillId) void open(initialSkillId);
  }, [initialSkillId]);
  const remove = useMutation({
    mutationFn: (skill: ReviewSkillSummary) =>
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {capabilities.canCreate ? (
            <Button type="button" onClick={() => setEditor("create")}>
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
          Web originals and accepted live links
        </p>
      </div>
      <SkillSearch value={search} onChange={setSearch} />
      <SkillsError error={error ?? library.error ?? remove.error} />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[48rem] border-collapse">
          <caption className="sr-only">Workspace review skills</caption>
          <thead>
            <tr className="border-b border-cyan-200/20 text-slate-400">
              <th className={skillCellClass}>Name / description</th>
              <th className={skillCellClass}>Author</th>
              <th className={skillCellClass}>Source</th>
              <th className={skillCellClass}>Used in this workspace</th>
              <th className={skillCellClass}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((skill) => (
              <tr key={skill.skillId} className="border-b border-cyan-200/10">
                <td className={skillCellClass}>
                  <button
                    type="button"
                    className="text-left font-semibold text-cyan-100 underline-offset-4 hover:underline"
                    onClick={() => {
                      void open(skill.skillId);
                    }}
                  >
                    {skill.name}
                  </button>
                  <p className="mt-1 max-w-sm whitespace-pre-wrap text-slate-400">
                    {skill.description}
                  </p>
                  <p className="mt-2 text-xs text-slate-500">
                    Updated {new Date(skill.updatedAt).toLocaleDateString()}
                  </p>
                </td>
                <td className={`${skillCellClass} text-slate-300`}>
                  {skill.authorName}
                </td>
                <td className={`${skillCellClass} text-slate-400`}>
                  {skill.sourceWorkspaceName}
                  <span className="mt-1 block text-xs">
                    {skill.linked ? "Live link" : "Original"}
                  </span>
                </td>
                <td className={`${skillCellClass} text-slate-400`}>
                  <span>{skill.usedIn.length} repositories</span>
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
                </td>
                <td className={skillCellClass}>
                  <div className="flex flex-wrap gap-2">
                    {skill.capabilities.canEdit ? (
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
                      Repositories
                    </Button>
                    {skill.capabilities.canGrant && !skill.linked ? (
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
                      skill.linked
                        ? capabilities.canAdmin
                        : skill.capabilities.canDelete
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
          onClose={() => setEditor(null)}
          onSaved={(document) => {
            setEditor(null);
            setRepositories(document);
            void invalidate();
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
  readonly skill: ReviewSkillSummary;
  readonly canCreate: boolean;
  readonly onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [captured, setCaptured] = useState<readonly string[] | null>(null);
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
        repositoryIds={captured}
        canCreate={canCreate}
        initialSkillIds={[skill.skillId]}
        onClose={onClose}
      />
    );
  return (
    <SkillsDialog
      open
      onClose={onClose}
      title="Assign skill to repositories"
      description={`Choose repository targets for “${skill.name}”, then add or remove assignments. No existing assignments are preselected.`}
      footer={
        <Button
          type="button"
          disabled={selected.size === 0}
          onClick={() => setCaptured([...selected])}
        >
          Manage selected repositories ({selected.size})
        </Button>
      }
    >
      <SkillSearch
        value={search}
        onChange={setSearch}
        label="Search repositories"
      />
      <SkillsError error={targets.error} />
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
                onChange={() =>
                  setSelected((prior) => {
                    const next = new Set(prior);
                    if (next.has(repo.repositoryId))
                      next.delete(repo.repositoryId);
                    else next.add(repo.repositoryId);
                    return next;
                  })
                }
              />
              <span className="min-w-0 flex-1 break-all">{repo.name}</span>
              <span className="text-xs text-slate-400">
                {repo.assigned ? "Assigned" : "Not assigned"}
              </span>
            </label>
          ))}
      </div>
      {targets.hasNextPage ? (
        <Button
          type="button"
          variant="outline"
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
