"use client";
import { useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Button } from "@reviewrouter/ui";
import type { ReviewSkillSummary } from "../../src/features/review-skills/contracts";
import { requestReviewSkills } from "../../src/features/review-skills/client-adapter";
import { reviewSkillsKeys } from "../../src/features/review-skills/query-keys";
import {
  SkillsDialog,
  SkillsError,
  SkillSearch,
  skillCellClass,
  skillFieldClass,
  skillMobileLabelClass,
  skillResponsiveCellClass,
} from "./review-skills-ui";

export function SkillAccessDialog({
  workspaceId,
  viewerId,
  skill,
  onClose,
}: {
  readonly workspaceId: string;
  readonly viewerId: string;
  readonly skill: ReviewSkillSummary;
  readonly onClose: () => void;
}) {
  const [destination, setDestination] = useState("");
  const client = useQueryClient();
  const key = [
    ...reviewSkillsKeys.workspace(viewerId, workspaceId),
    "access",
    skill.skillId,
  ] as const;
  const grants = useQuery({
    queryKey: key,
    queryFn: () =>
      requestReviewSkills("loadSkillAccess", {
        workspaceId,
        skillId: skill.skillId,
      }),
    staleTime: 10_000,
    retry: false,
  });
  const grant = useMutation({
    mutationFn: () =>
      requestReviewSkills("grantSkill", {
        sourceWorkspaceId: workspaceId,
        skillId: skill.skillId,
        destinationWorkspaceId: destination.trim(),
      }),
    onSuccess: async () => {
      setDestination("");
      await client.invalidateQueries({ queryKey: key, exact: true });
    },
  });
  const revoke = useMutation({
    mutationFn: (input: {
      destinationWorkspaceId: string;
      expectedGrantVersion: number;
    }) =>
      requestReviewSkills("revokeSkillGrant", {
        sourceWorkspaceId: workspaceId,
        skillId: skill.skillId,
        ...input,
      }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: key, exact: true });
    },
  });
  const pending = grant.isPending || revoke.isPending;
  return (
    <SkillsDialog
      open
      onClose={onClose}
      pending={pending}
      title="Manage skill access"
      description={`Share “${skill.name}” with another workspace. Its admins accept access in their Skills library. Revoking access blocks future reviews from using this skill; reviews already in progress keep the instructions they started with.`}
    >
      <label className="block text-sm">
        Destination workspace ID
        <input
          className={`${skillFieldClass} mt-2`}
          value={destination}
          disabled={pending}
          onChange={(event) => setDestination(event.target.value)}
          placeholder="Exact workspace ID"
        />
      </label>
      <p className="text-xs text-slate-400">
        Ask the destination admin for the workspace ID shown in their Skills
        section. No public workspace directory is searched.
      </p>
      <Button
        type="button"
        disabled={!destination.trim() || pending}
        onClick={() => {
          revoke.reset();
          grant.mutate();
        }}
      >
        {grant.isPending ? "Granting access…" : "Grant access"}
      </Button>
      <SkillsError error={grant.error ?? revoke.error ?? grants.error} />
      {grants.isPending ? <p role="status">Loading workspace access…</p> : null}
      {grant.isSuccess ? (
        <p role="status" className="text-sm text-emerald-200">
          Access granted. The destination workspace admins can accept this skill
          in their Skills library.
        </p>
      ) : revoke.isSuccess ? (
        <p role="status" className="text-sm text-emerald-200">
          Access revoked for future reviews in that workspace.
        </p>
      ) : null}
      {!grants.isPending && !grants.isError && grants.data?.length === 0 ? (
        <p className="text-sm text-slate-400">
          This skill has not been shared with another workspace.
        </p>
      ) : null}
      <div className="divide-y divide-cyan-200/15">
        {grants.data?.map((item) => (
          <div
            key={item.destinationWorkspaceId}
            className="flex flex-wrap items-center justify-between gap-3 py-3"
          >
            <div className="min-w-0 text-sm">
              <p className="break-all text-cyan-50">
                {item.destinationWorkspaceName ?? item.destinationWorkspaceId}
              </p>
              <p className="mt-1 text-xs text-slate-400">
                {item.active
                  ? item.accepted
                    ? "Accepted"
                    : "Awaiting destination acceptance"
                  : "Revoked"}{" "}
              </p>
            </div>
            {item.active ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() => {
                  if (
                    window.confirm(
                      "Revoke access for future reviews in this workspace?",
                    )
                  ) {
                    grant.reset();
                    revoke.mutate({
                      destinationWorkspaceId: item.destinationWorkspaceId,
                      expectedGrantVersion: item.version,
                    });
                  }
                }}
              >
                Revoke access
              </Button>
            ) : null}
          </div>
        ))}
      </div>
    </SkillsDialog>
  );
}
export function AddWorkspaceSkillDialog({
  workspaceId,
  viewerId,
  onClose,
  onAssign,
}: {
  readonly workspaceId: string;
  readonly viewerId: string;
  readonly onClose: () => void;
  readonly onAssign: (skill: ReviewSkillSummary) => void;
}) {
  const [search, setSearch] = useState("");
  const [linkedSkill, setLinkedSkill] = useState<ReviewSkillSummary | null>(
    null,
  );
  const client = useQueryClient();
  const choices = useInfiniteQuery({
    queryKey: [
      ...reviewSkillsKeys.workspace(viewerId, workspaceId),
      "linkable",
      search,
    ],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      requestReviewSkills("listLinkableSkills", {
        destinationWorkspaceId: workspaceId,
        search,
        cursor: pageParam,
      }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    staleTime: 10_000,
    retry: false,
  });
  const link = useMutation({
    mutationFn: (
      skill: NonNullable<typeof choices.data>["pages"][number]["items"][number],
    ) =>
      skill.canLinkAsDualAdmin
        ? requestReviewSkills("linkSkillAsDualAdmin", {
            sourceWorkspaceId: skill.sourceWorkspaceId,
            destinationWorkspaceId: workspaceId,
            skillId: skill.skillId,
          })
        : requestReviewSkills("acceptSkillGrant", {
            destinationWorkspaceId: workspaceId,
            skillId: skill.skillId,
            expectedGrantVersion: skill.grantVersion!,
          }),
    onSuccess: async (_result, skill) => {
      setLinkedSkill(skill);
      await client.invalidateQueries({
        queryKey: reviewSkillsKeys.workspace(viewerId, workspaceId),
      });
    },
  });
  const rows = choices.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <SkillsDialog
      open
      onClose={onClose}
      pending={link.isPending}
      title="Add from another workspace"
      description="Add a live link to the original. The author controls its text; future reviews receive subsequent saved updates. This does not create a copy."
    >
      <SkillSearch
        value={search}
        onChange={setSearch}
        disabled={link.isPending}
      />
      <SkillsError error={choices.error ?? link.error} />
      {choices.isPending ? <p role="status">Loading shared skills…</p> : null}
      {linkedSkill ? (
        <div className="space-y-3 border-b border-cyan-200/15 pb-4">
          <p role="status" className="text-sm text-emerald-200">
            “{linkedSkill.name}” added to this library. Choose repositories to
            use it.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={link.isPending}
              onClick={() => onAssign(linkedSkill)}
            >
              Assign to repositories
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={link.isPending}
              onClick={() => setLinkedSkill(null)}
            >
              Continue adding skills
            </Button>
          </div>
        </div>
      ) : null}
      <div className="overflow-x-auto">
        <table role="table" className="block w-full lg:table lg:min-w-[30rem]">
          <caption className="sr-only">
            Skills shared from other workspaces
          </caption>
          <thead role="rowgroup" className="hidden lg:table-header-group">
            <tr role="row" className="border-b border-cyan-200/15">
              <th role="columnheader" scope="col" className={skillCellClass}>
                Name / description
              </th>
              <th role="columnheader" scope="col" className={skillCellClass}>
                Author / source
              </th>
              <th role="columnheader" scope="col" className={skillCellClass}>
                Access
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
                  <p className="break-words font-semibold">{skill.name}</p>
                  <p className="mt-1 break-words text-slate-400">
                    {skill.description}
                  </p>
                </td>
                <td
                  role="cell"
                  className={`${skillResponsiveCellClass} break-words`}
                >
                  <span className={skillMobileLabelClass}>Author / source</span>
                  {skill.authorName}
                  <br />
                  <span className="text-slate-400">
                    {skill.sourceWorkspaceName}
                  </span>
                </td>
                <td role="cell" className={skillResponsiveCellClass}>
                  <span className={skillMobileLabelClass}>Access</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={
                      link.isPending ||
                      linkedSkill?.skillId === skill.skillId ||
                      (!skill.canLinkAsDualAdmin && !skill.canAccept)
                    }
                    onClick={() => link.mutate(skill)}
                  >
                    {linkedSkill?.skillId === skill.skillId
                      ? "Added"
                      : skill.canLinkAsDualAdmin
                        ? "Add"
                        : "Accept"}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && !choices.isPending && !choices.isError ? (
        <p className="text-sm text-slate-400">
          No matching originals are available. A source owner/admin must grant
          this workspace access, or you must administer both workspaces.
        </p>
      ) : null}
      {choices.hasNextPage ? (
        <Button
          type="button"
          variant="outline"
          disabled={choices.isFetchingNextPage || link.isPending}
          onClick={() => {
            void choices.fetchNextPage();
          }}
        >
          Load more skills
        </Button>
      ) : null}
    </SkillsDialog>
  );
}
