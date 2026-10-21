"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox } from "@reviewrouter/ui";
import type {
  ReviewSkillBindingView,
  ReviewSkillSourceRoot,
} from "../../src/features/review-skills/contracts";
import { requestReviewSkills } from "../../src/features/review-skills/client-adapter";
import { reviewSkillsKeys } from "../../src/features/review-skills/query-keys";
import { SkillsError, skillFieldClass } from "./review-skills-ui";

export function RepositorySkillSettings({
  workspaceId,
  viewerId,
  repositoryId,
}: {
  readonly workspaceId: string;
  readonly viewerId: string;
  readonly repositoryId: string;
}) {
  const [enabled, setEnabled] = useState(false);
  const client = useQueryClient();
  const key = [
    ...reviewSkillsKeys.workspace(viewerId, workspaceId),
    "repository-settings",
    repositoryId,
  ] as const;
  const settings = useQuery({
    queryKey: key,
    queryFn: () =>
      requestReviewSkills("loadRepositorySkillSettings", {
        workspaceId,
        repositoryId,
      }),
    enabled,
    staleTime: 10_000,
    retry: false,
  });
  const sources = useMutation({
    mutationFn: (roots: readonly ReviewSkillSourceRoot[]) =>
      requestReviewSkills("setRepositorySources", {
        workspaceId,
        repositoryId,
        expectedVersion: settings.data?.sourceVersion ?? 0,
        roots,
      }),
    onSuccess: (value) => {
      client.setQueryData(key, value);
    },
  });
  return (
    <details
      className="border-t border-cyan-200/15 pt-3"
      onToggle={(event) => setEnabled(event.currentTarget.open)}
    >
      <summary className="cursor-pointer text-sm text-slate-300">
        Repository paths and Git skills
      </summary>
      <div className="mt-4 space-y-4">
        <p className="text-sm text-slate-400">
          Use skills from repository only when explicitly enabled below.
          ReviewRouter reads SKILL.md files from the review's trusted base
          commit, never from changes introduced by that same PR. Git-managed
          skills are read-only here. Discovery failures block the review and
          appear in its diagnostics; full Git content is not stored in the
          workspace library.
        </p>
        {settings.isPending ? (
          <p role="status">Loading repository settings…</p>
        ) : null}
        <SkillsError error={settings.error ?? sources.error} />
        {settings.data ? (
          <>
            <fieldset disabled={sources.isPending} className="grid gap-3">
              <legend className="mb-3 text-sm font-semibold">
                Use skills from repository
              </legend>
              {([".reviewrouter/skills", ".agents/skills"] as const).map(
                (root) => (
                  <label key={root} className="flex items-center gap-3 text-sm">
                    <Checkbox
                      checked={settings.data!.roots.includes(root)}
                      onChange={(event) => {
                        const roots = event.target.checked
                          ? [...settings.data!.roots, root]
                          : settings.data!.roots.filter(
                              (value) => value !== root,
                            );
                        sources.mutate(roots);
                      }}
                    />
                    {root}
                  </label>
                ),
              )}
            </fieldset>
            <p className="text-xs text-slate-500">
              Git sources: {settings.data.roots.length ? "enabled" : "disabled"}{" "}
              · settings version {settings.data.sourceVersion}
            </p>
            {settings.data.bindings.map((binding) => (
              <BindingPaths
                key={`${binding.skillId}:${binding.version}`}
                workspaceId={workspaceId}
                repositoryId={repositoryId}
                binding={binding}
                onSaved={() => {
                  void client.invalidateQueries({ queryKey: key, exact: true });
                }}
              />
            ))}
            {settings.data.unavailable.map((item) => (
              <p key={item.skillId} className="text-sm text-amber-100">
                Unavailable skill {item.skillId}. Use Remove to clear its
                assignment.
              </p>
            ))}
          </>
        ) : null}
      </div>
    </details>
  );
}
function BindingPaths({
  workspaceId,
  repositoryId,
  binding,
  onSaved,
}: {
  readonly workspaceId: string;
  readonly repositoryId: string;
  readonly binding: ReviewSkillBindingView;
  readonly onSaved: () => void;
}) {
  const [include, setInclude] = useState(binding.scope.includePaths.join("\n"));
  const [exclude, setExclude] = useState(binding.scope.excludePaths.join("\n"));
  const save = useMutation({
    mutationFn: () =>
      requestReviewSkills("updateBindingScope", {
        workspaceId,
        repositoryId,
        skillId: binding.skillId,
        expectedVersion: binding.version,
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
      }),
    onSuccess: onSaved,
  });
  return (
    <details className="border-t border-cyan-200/10 pt-3">
      <summary className="cursor-pointer text-sm">
        Paths · {binding.skillId}
      </summary>
      <div className="mt-3 space-y-3">
        <label className="block text-sm">
          Include paths
          <textarea
            className={`${skillFieldClass} mt-2 font-mono`}
            rows={2}
            value={include}
            onChange={(event) => setInclude(event.target.value)}
          />
        </label>
        <label className="block text-sm">
          Exclude paths
          <textarea
            className={`${skillFieldClass} mt-2 font-mono`}
            rows={2}
            value={exclude}
            onChange={(event) => setExclude(event.target.value)}
          />
        </label>
        <Button
          type="button"
          variant="outline"
          disabled={save.isPending}
          onClick={() => save.mutate()}
        >
          Save paths
        </Button>
        <SkillsError error={save.error} />
      </div>
    </details>
  );
}
