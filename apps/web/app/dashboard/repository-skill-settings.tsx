"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox } from "@reviewrouter/ui";
import type {
  ReviewSkillBindingView,
  ReviewSkillSourceRoot,
} from "../../src/features/review-skills/contracts";
import {
  requestReviewSkills,
  ReviewSkillsClientError,
} from "../../src/features/review-skills/client-adapter";
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
        {sources.isError ? (
          <Button
            type="button"
            variant="outline"
            disabled={settings.isFetching}
            onClick={() => {
              void settings.refetch();
            }}
          >
            Refresh repository settings
          </Button>
        ) : null}
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
              Git sources:{" "}
              {settings.data.roots.length ? "enabled" : "disabled"}{" "}
            </p>
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
export function SkillBindingPaths({
  workspaceId,
  viewerId,
  repositoryId,
  binding,
  onSaved,
}: {
  readonly workspaceId: string;
  readonly viewerId: string;
  readonly repositoryId: string;
  readonly binding: ReviewSkillBindingView;
  readonly onSaved: () => void;
}) {
  const [include, setInclude] = useState(binding.scope.includePaths.join("\n"));
  const [exclude, setExclude] = useState(binding.scope.excludePaths.join("\n"));
  const [expectedVersion, setExpectedVersion] = useState(binding.version);
  const [showComparison, setShowComparison] = useState(false);
  const currentPaths = useQuery({
    queryKey: [
      ...reviewSkillsKeys.workspace(viewerId, workspaceId),
      "binding-paths",
      repositoryId,
      binding.skillId,
    ],
    queryFn: async () => {
      const settings = await requestReviewSkills(
        "loadRepositorySkillSettings",
        {
          workspaceId,
          repositoryId,
        },
      );
      const current = settings.bindings.find(
        (value) => value.skillId === binding.skillId,
      );
      if (!current)
        throw new Error(
          "This assignment was removed. Close and refresh assignments before adding it again.",
        );
      return current;
    },
    enabled: false,
    staleTime: 0,
    retry: false,
  });
  const save = useMutation({
    mutationFn: () =>
      requestReviewSkills("updateBindingScope", {
        workspaceId,
        repositoryId,
        skillId: binding.skillId,
        expectedVersion,
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
    onSuccess: (saved) => {
      setExpectedVersion(saved.version);
      setInclude(saved.scope.includePaths.join("\n"));
      setExclude(saved.scope.excludePaths.join("\n"));
      setShowComparison(false);
      onSaved();
    },
  });
  const conflict =
    save.error instanceof ReviewSkillsClientError &&
    save.error.code === "conflict";
  const reconcile = (useSaved: boolean) => {
    if (!currentPaths.data || currentPaths.isFetching || currentPaths.isError)
      return;
    if (useSaved) {
      setInclude(currentPaths.data.scope.includePaths.join("\n"));
      setExclude(currentPaths.data.scope.excludePaths.join("\n"));
    }
    setExpectedVersion(currentPaths.data.version);
    setShowComparison(false);
    save.reset();
  };
  return (
    <details className="border-t border-cyan-200/10 pt-3">
      <summary className="cursor-pointer text-sm">Paths</summary>
      <div className="mt-3 space-y-3">
        <label className="block text-sm">
          Include paths
          <textarea
            className={`${skillFieldClass} mt-2 font-mono`}
            rows={2}
            disabled={save.isPending}
            value={include}
            onChange={(event) => setInclude(event.target.value)}
          />
        </label>
        <label className="block text-sm">
          Exclude paths
          <textarea
            className={`${skillFieldClass} mt-2 font-mono`}
            rows={2}
            disabled={save.isPending}
            value={exclude}
            onChange={(event) => setExclude(event.target.value)}
          />
        </label>
        <Button
          type="button"
          variant="outline"
          disabled={save.isPending || conflict}
          onClick={() => save.mutate()}
        >
          Save paths
        </Button>
        <SkillsError error={save.error} />
        {conflict ? (
          <Button
            type="button"
            variant="outline"
            disabled={currentPaths.isFetching}
            onClick={() => {
              setShowComparison(true);
              void currentPaths.refetch();
            }}
          >
            Keep draft and compare current paths
          </Button>
        ) : null}
        {showComparison ? (
          <>
            {currentPaths.isFetching ? (
              <p role="status">Loading current saved paths…</p>
            ) : null}
            <SkillsError error={currentPaths.error} />
            {currentPaths.data &&
            !currentPaths.isFetching &&
            !currentPaths.isError ? (
              <section
                aria-label="Current saved paths"
                className="space-y-3 border-t border-cyan-200/20 pt-3"
              >
                <h4 className="font-semibold">Current saved paths</h4>
                <p className="text-xs text-slate-400">
                  Your draft remains above. Compare it with these saved paths
                  before choosing how to proceed.
                </p>
                <dl className="space-y-2 text-xs">
                  <dt className="text-slate-400">Include paths</dt>
                  <dd className="whitespace-pre-wrap break-all font-mono">
                    {currentPaths.data.scope.includePaths.join("\n")}
                  </dd>
                  <dt className="text-slate-400">Exclude paths</dt>
                  <dd className="whitespace-pre-wrap break-all font-mono">
                    {currentPaths.data.scope.excludePaths.join("\n") || "None"}
                  </dd>
                </dl>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => reconcile(true)}
                  >
                    Use current saved paths
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => reconcile(false)}
                  >
                    Keep reconciled paths
                  </Button>
                </div>
              </section>
            ) : null}
          </>
        ) : null}
      </div>
    </details>
  );
}
