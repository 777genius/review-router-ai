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

export type SkillBindingPathsDraft = {
  readonly include: string;
  readonly exclude: string;
  readonly savedInclude: string;
  readonly savedExclude: string;
  readonly expectedVersion: number;
  readonly expectedGeneration: string;
};

export function skillBindingPathsDraftIsDirty(draft: SkillBindingPathsDraft) {
  return (
    draft.include !== draft.savedInclude || draft.exclude !== draft.savedExclude
  );
}

export function skillScopeSummary(scope: ReviewSkillBindingView["scope"]) {
  const summarize = (paths: readonly string[]) =>
    `${paths.slice(0, 2).join(", ")}${paths.length > 2 ? ` and ${paths.length - 2} more` : ""}`;
  const included =
    scope.includePaths.length === 1 && scope.includePaths[0] === "**"
      ? "All files"
      : summarize(scope.includePaths);
  return `${included}${scope.excludePaths.length ? `, except ${summarize(scope.excludePaths)}` : ""}`;
}

function bindingPathsDraft(
  binding: ReviewSkillBindingView,
): SkillBindingPathsDraft {
  const include = binding.scope.includePaths.join("\n");
  const exclude = binding.scope.excludePaths.join("\n");
  return {
    include,
    exclude,
    savedInclude: include,
    savedExclude: exclude,
    expectedVersion: binding.version,
    expectedGeneration: binding.generation,
  };
}

type PendingChange = (key: string, pending: boolean) => void;

export function RepositorySkillSettings({
  workspaceId,
  viewerId,
  repositoryId,
  locked,
  onPendingChange,
}: {
  readonly workspaceId: string;
  readonly viewerId: string;
  readonly repositoryId: string;
  readonly locked: boolean;
  readonly onPendingChange: PendingChange;
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
    onMutate: () => onPendingChange(`repository-sources:${repositoryId}`, true),
    mutationFn: (roots: readonly ReviewSkillSourceRoot[]) =>
      requestReviewSkills("setRepositorySources", {
        workspaceId,
        repositoryId,
        expectedVersion: settings.data?.sourceVersion ?? 0,
        roots,
      }),
    onSuccess: async (value) => {
      // The write returns domain settings; retain the web reader's advisory
      // projection until the exact enriched read has refreshed.
      client.setQueryData<NonNullable<typeof settings.data>>(key, (prior) =>
        prior ? { ...value, readiness: prior.readiness } : undefined,
      );
      await client.invalidateQueries({ queryKey: key, exact: true });
    },
    onSettled: () =>
      onPendingChange(`repository-sources:${repositoryId}`, false),
  });
  return (
    <details
      className="border-t border-cyan-200/15 pt-3"
      onToggle={(event) => setEnabled(event.currentTarget.open)}
    >
      <summary className="cursor-pointer text-sm text-slate-300">
        Skills from this repository
      </summary>
      <div className="mt-4 space-y-4">
        <p className="text-sm text-slate-400">
          Read SKILL.md files from the review's trusted base commit. Changes
          introduced by the PR itself do not change that review's instructions.
          Edit these skills in Git. Text instructions and supported Markdown
          references are available; discovery failures stop the review with
          diagnostics.
        </p>
        <p className="text-xs text-slate-400">Changes save immediately.</p>
        {settings.isPending ? (
          <p role="status">Loading repository settings…</p>
        ) : null}
        <SkillsError error={settings.error ?? sources.error} />
        {sources.isPending ? (
          <p role="status">Saving repository sources…</p>
        ) : sources.isSuccess ? (
          <p role="status" className="text-sm text-emerald-200">
            Repository skill sources saved.
          </p>
        ) : null}
        {sources.isError || settings.isError ? (
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
            <fieldset
              disabled={sources.isPending || locked}
              className="grid gap-3"
            >
              <legend className="mb-3 text-sm font-semibold">
                Read SKILL.md from
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
  draft,
  locked,
  onDraftChange,
  onPendingChange,
  onSaved,
}: {
  readonly workspaceId: string;
  readonly viewerId: string;
  readonly repositoryId: string;
  readonly binding: ReviewSkillBindingView;
  readonly draft?: SkillBindingPathsDraft;
  readonly locked: boolean;
  readonly onDraftChange: (
    skillId: string,
    draft: SkillBindingPathsDraft,
  ) => void;
  readonly onPendingChange: PendingChange;
  readonly onSaved: (
    skillId: string,
    draft: SkillBindingPathsDraft,
  ) => Promise<void>;
}) {
  // Editing snapshots survive filtering and retain their CAS tokens through
  // background refreshes. Untouched rows continue to read query data directly.
  const current = draft ?? bindingPathsDraft(binding);
  const { include, exclude, expectedVersion, expectedGeneration } = current;
  const updateDraft = (changes: Partial<SkillBindingPathsDraft>) =>
    onDraftChange(binding.skillId, { ...current, ...changes });
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
    onMutate: () => onPendingChange(`binding-paths:${binding.skillId}`, true),
    mutationFn: () =>
      requestReviewSkills("updateBindingScope", {
        workspaceId,
        repositoryId,
        skillId: binding.skillId,
        expectedVersion,
        expectedGeneration,
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
    onSuccess: async (saved) => {
      const acknowledged = bindingPathsDraft(saved);
      onDraftChange(binding.skillId, acknowledged);
      setShowComparison(false);
      await onSaved(binding.skillId, acknowledged);
    },
    onSettled: () => onPendingChange(`binding-paths:${binding.skillId}`, false),
  });
  const conflict =
    save.error instanceof ReviewSkillsClientError &&
    save.error.code === "conflict";
  const reconcile = (useSaved: boolean) => {
    if (!currentPaths.data || currentPaths.isFetching || currentPaths.isError)
      return;
    const saved = bindingPathsDraft(currentPaths.data);
    const reconciled = useSaved ? saved : { ...saved, include, exclude };
    onDraftChange(binding.skillId, reconciled);
    void onSaved(binding.skillId, reconciled);
    setShowComparison(false);
    save.reset();
  };
  return (
    <details className="border-t border-cyan-200/10 pt-3">
      <summary className="cursor-pointer text-sm">File scope</summary>
      <div className="mt-3 space-y-3">
        <p className="text-xs leading-5 text-slate-400">
          One repository-relative POSIX glob per line, such as src/**. Excludes
          take priority. Save applies this scope to future reviews.
        </p>
        <label className="block text-sm">
          Include paths
          <textarea
            className={`${skillFieldClass} mt-2 font-mono`}
            rows={2}
            disabled={save.isPending || locked}
            value={include}
            onChange={(event) => updateDraft({ include: event.target.value })}
          />
        </label>
        <label className="block text-sm">
          Exclude paths
          <textarea
            className={`${skillFieldClass} mt-2 font-mono`}
            rows={2}
            disabled={save.isPending || locked}
            value={exclude}
            onChange={(event) => updateDraft({ exclude: event.target.value })}
          />
        </label>
        <Button
          type="button"
          variant="outline"
          disabled={
            save.isPending ||
            locked ||
            conflict ||
            !skillBindingPathsDraftIsDirty(current)
          }
          onClick={() => save.mutate()}
        >
          {save.isPending ? "Saving paths…" : "Save paths"}
        </Button>
        {save.isSuccess && !skillBindingPathsDraftIsDirty(current) ? (
          <p role="status" className="text-sm text-emerald-200">
            File scope saved.
          </p>
        ) : null}
        <SkillsError error={save.error} />
        {conflict ? (
          <Button
            type="button"
            variant="outline"
            disabled={currentPaths.isFetching || locked}
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
                    disabled={locked}
                    onClick={() => reconcile(true)}
                  >
                    Use current saved paths
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={locked}
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
