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
    onSuccess: () => {
      setDestination("");
      void client.invalidateQueries({ queryKey: key, exact: true });
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
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: key, exact: true });
    },
  });
  return (
    <SkillsDialog
      open
      onClose={onClose}
      pending={grant.isPending || revoke.isPending}
      title="Manage skill access"
      description={`Share the canonical original “${skill.name}”. Destination admins accept access in their Skills library. Revocation blocks new admissions; already admitted reviews keep their captured instructions.`}
    >
      <label className="block text-sm">
        Destination workspace ID
        <input
          className={`${skillFieldClass} mt-2`}
          value={destination}
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
        disabled={!destination.trim() || grant.isPending}
        onClick={() => grant.mutate()}
      >
        Grant access
      </Button>
      <SkillsError error={grants.error ?? grant.error ?? revoke.error} />
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
                disabled={revoke.isPending}
                onClick={() => {
                  if (
                    window.confirm(
                      "Revoke access for future reviews in this workspace?",
                    )
                  )
                    revoke.mutate({
                      destinationWorkspaceId: item.destinationWorkspaceId,
                      expectedGrantVersion: item.version,
                    });
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
}: {
  readonly workspaceId: string;
  readonly viewerId: string;
  readonly onClose: () => void;
}) {
  const [search, setSearch] = useState("");
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
    onSuccess: async () => {
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
      <SkillSearch value={search} onChange={setSearch} />
      <SkillsError error={choices.error ?? link.error} />
      {link.isSuccess ? (
        <p role="status" className="text-emerald-200">
          Skill linked to this workspace.
        </p>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[30rem]">
          <thead>
            <tr className="border-b border-cyan-200/15">
              <th className={skillCellClass}>Name / description</th>
              <th className={skillCellClass}>Author / source</th>
              <th className={skillCellClass}>Access</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((skill) => (
              <tr key={skill.skillId} className="border-b border-cyan-200/10">
                <td className={skillCellClass}>
                  <p className="font-semibold">{skill.name}</p>
                  <p className="mt-1 text-slate-400">{skill.description}</p>
                </td>
                <td className={skillCellClass}>
                  {skill.authorName}
                  <br />
                  <span className="text-slate-400">
                    {skill.sourceWorkspaceName}
                  </span>
                </td>
                <td className={skillCellClass}>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={
                      link.isPending ||
                      (!skill.canLinkAsDualAdmin && !skill.canAccept)
                    }
                    onClick={() => link.mutate(skill)}
                  >
                    {skill.canLinkAsDualAdmin ? "Add" : "Accept"}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && !choices.isPending ? (
        <p className="text-sm text-slate-400">
          No matching originals are available. A source owner/admin must grant
          this workspace access, or you must administer both workspaces.
        </p>
      ) : null}
      {choices.hasNextPage ? (
        <Button
          type="button"
          variant="outline"
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
