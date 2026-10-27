"use client";

import { useEffect, useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Button, Checkbox } from "@reviewrouter/ui";
import type { ReviewSkillDocument } from "../../src/features/review-skills/contracts";
import type {
  ReviewSkillScan,
  ReviewSkillScanMode,
  ReviewSkillsCatalogSelection,
  SkillCatalogInput,
} from "../../src/features/review-skills/catalog-contracts";
import {
  requestSkillCatalog,
  SkillCatalogClientError,
} from "../../src/features/review-skills/catalog-client-adapter";
import { skillCatalogKeys } from "../../src/features/review-skills/catalog-query-keys";
import { SkillsDialog, SkillsError, SkillSearch } from "./review-skills-ui";

type ScanAttempt = Readonly<{
  command: SkillCatalogInput<"requestScan">;
  scanId?: string;
  uncertain: boolean;
}>;
const attemptKey = (candidateId: string, mode: ReviewSkillScanMode) =>
  `${candidateId}:${mode}`;
const isUnknown = (error: unknown) =>
  error instanceof SkillCatalogClientError && error.code === "unknown";
const isForbidden = (error: unknown) =>
  error instanceof SkillCatalogClientError && error.code === "forbidden";
const isRunning = (scan: ReviewSkillScan | undefined) =>
  scan?.status === "queued" || scan?.status === "running";

/** Kept mounted by the library so closing never loses an outstanding command. */
export function SkillCatalogDialog({
  open,
  workspaceId,
  viewerId,
  onClose,
  onImported,
}: {
  readonly open: boolean;
  readonly workspaceId: string;
  readonly viewerId: string;
  readonly onClose: () => void;
  readonly onImported: (document: ReviewSkillDocument) => void;
}) {
  const client = useQueryClient();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selection, setSelection] =
    useState<ReviewSkillsCatalogSelection | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [mode, setMode] = useState<ReviewSkillScanMode>("static");
  const [attempts, setAttempts] = useState<Record<string, ScanAttempt>>({});
  const [acknowledgeWarnings, setAcknowledgeWarnings] = useState(false);
  const [acknowledgeOmissions, setAcknowledgeOmissions] = useState(false);
  const [importAttempt, setImportAttempt] =
    useState<SkillCatalogInput<"importCandidate"> | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    if (!open) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, [open]);
  const query = Array.from(debouncedSearch).length >= 2 ? debouncedSearch : "";
  const configuration = useQuery({
    queryKey: skillCatalogKeys.configuration(viewerId, workspaceId),
    queryFn: () => requestSkillCatalog("configuration", { workspaceId }),
    enabled: open,
    staleTime: 30_000,
    retry: false,
  });
  const listing = useInfiniteQuery({
    queryKey: skillCatalogKeys.search(viewerId, workspaceId, query),
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      requestSkillCatalog("search", { workspaceId, query, page: pageParam }),
    getNextPageParam: (page) => (page.hasMore ? page.page + 1 : undefined),
    enabled: open && !previewing,
    staleTime: 30_000,
    retry: false,
  });
  const resolve = useMutation({
    mutationFn: (input: ReviewSkillsCatalogSelection) =>
      requestSkillCatalog("resolve", { workspaceId, ...input }),
    retry: false,
  });
  const resolution = resolve.data;
  const candidate =
    resolution?.status === "resolved" ? resolution.candidate : undefined;
  const activeKey = attemptKey(candidate?.id ?? "", mode);
  const attempt = attempts[activeKey];
  const scanKey = skillCatalogKeys.scan(
    viewerId,
    workspaceId,
    candidate?.id ?? "",
    mode,
    attempt?.scanId ?? "",
  );
  const scanQuery = useQuery({
    queryKey: scanKey,
    queryFn: () =>
      requestSkillCatalog("loadScan", {
        workspaceId,
        scanId: attempt!.scanId!,
      }),
    enabled: open && previewing && Boolean(attempt?.scanId),
    staleTime: 0,
    retry: false,
    refetchInterval: (current) =>
      !current.state.error && isRunning(current.state.data) ? 1500 : false,
  });
  const scan = scanQuery.data;
  const requestScan = useMutation({
    mutationFn: (command: SkillCatalogInput<"requestScan">) =>
      requestSkillCatalog("requestScan", command),
    retry: false,
    onSuccess: (value, command) => {
      client.setQueryData(
        skillCatalogKeys.scan(
          viewerId,
          workspaceId,
          command.candidateId,
          command.mode,
          value.id,
        ),
        value,
      );
      setAttempts((current) => ({
        ...current,
        [attemptKey(command.candidateId, command.mode)]: {
          command,
          scanId: value.id,
          uncertain: false,
        },
      }));
    },
    onError: (error, command) => {
      setAttempts((current) => ({
        ...current,
        [attemptKey(command.candidateId, command.mode)]: {
          command,
          uncertain: isUnknown(error),
        },
      }));
    },
  });
  const add = useMutation({
    mutationFn: (command: SkillCatalogInput<"importCandidate">) =>
      requestSkillCatalog("importCandidate", command),
    retry: false,
    onSuccess: (document) => {
      setImportAttempt(null);
      setPreviewing(false);
      setSelection(null);
      resolve.reset();
      onImported(document);
    },
    onError: (error) => {
      if (!isUnknown(error)) setImportAttempt(null);
    },
  });
  const currentRequest =
    requestScan.variables?.candidateId === candidate?.id &&
    requestScan.variables?.mode === mode;
  const requesting = requestScan.isPending && currentRequest;
  const currentRequestError = currentRequest ? requestScan.error : null;
  const uncertainImport = Boolean(importAttempt) && isUnknown(add.error);
  const locked = add.isPending || uncertainImport;
  const profileLocked = locked || requesting || attempt?.uncertain === true;
  const permissionLost = [
    configuration.error,
    listing.error,
    resolve.error,
    scanQuery.error,
    currentRequestError,
    add.error,
  ].some(isForbidden);
  const expired =
    Boolean(candidate && Date.parse(candidate.expiresAt) <= now) ||
    Boolean(scan && Date.parse(scan.expiresAt) <= now);
  const exactScan = scan?.candidateId === candidate?.id && scan?.mode === mode;
  const eligible =
    exactScan &&
    scan?.status === "completed" &&
    (scan.verdict === "clear" || scan.verdict === "warnings") &&
    !expired;
  const needsOmissions = Boolean(
    candidate?.omittedFields.length || candidate?.hasResources,
  );
  const scanAvailable = configuration.data?.scanAvailable === true;
  const selectedProfileAvailable =
    scanAvailable &&
    (mode === "static" || configuration.data?.aiAvailable === true);
  const canAdd =
    eligible &&
    selectedProfileAvailable &&
    !scanQuery.isError &&
    (!needsOmissions || acknowledgeOmissions) &&
    (scan?.verdict !== "warnings" || acknowledgeWarnings);
  const rows = listing.data?.pages.flatMap((page) => page.items) ?? [];

  function select(input: ReviewSkillsCatalogSelection) {
    if (locked) return;
    add.reset();
    setPreviewing(true);
    setMode("static");
    setAcknowledgeWarnings(false);
    setAcknowledgeOmissions(false);
    const reusable =
      resolve.data?.status === "selection_required" ||
      (resolve.data?.status === "resolved" &&
        Date.parse(resolve.data.candidate.expiresAt) > Date.now());
    if (
      JSON.stringify(selection) !== JSON.stringify(input) ||
      resolve.isError ||
      !reusable
    ) {
      setSelection(input);
      resolve.mutate(input);
    }
  }
  function check() {
    if (
      !candidate ||
      requesting ||
      isRunning(scan) ||
      locked ||
      !selectedProfileAvailable
    )
      return;
    const command =
      attempt && !attempt.scanId
        ? attempt.command
        : {
            workspaceId,
            candidateId: candidate.id,
            mode,
            operationId: crypto.randomUUID(),
          };
    setAttempts((current) => ({
      ...current,
      [activeKey]: { command, uncertain: false },
    }));
    setAcknowledgeWarnings(false);
    requestScan.mutate(command);
  }
  function importSkill() {
    if (!candidate || (!canAdd && !uncertainImport)) return;
    const command = importAttempt ?? {
      workspaceId,
      candidateId: candidate.id,
      scanId: scan!.id,
      mode,
      acknowledgeWarnings,
      acknowledgeOmissions,
    };
    setImportAttempt(command);
    add.mutate(command);
  }
  const feedback = previewing
    ? (resolve.error ??
      (isUnknown(currentRequestError) ? null : currentRequestError) ??
      scanQuery.error ??
      (isUnknown(add.error) ? null : add.error) ??
      configuration.error)
    : listing.error;

  return (
    <SkillsDialog
      open={open}
      onClose={onClose}
      pending={add.isPending}
      title="Browse skills"
      description="Find review instructions, check them, and add them to your workspace."
      feedback={<SkillsError error={feedback} />}
      footer={
        previewing ? (
          <>
            <Button
              type="button"
              variant="outline"
              disabled={locked}
              onClick={() => setPreviewing(false)}
            >
              Back to results
            </Button>
            {candidate && !resolve.isPending && !permissionLost ? (
              <>
                {!eligible && (scan?.verdict !== "blocked" || expired) ? (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={
                      locked ||
                      requesting ||
                      isRunning(scan) ||
                      !selectedProfileAvailable ||
                      Boolean(
                        candidate && Date.parse(candidate.expiresAt) <= now,
                      )
                    }
                    onClick={check}
                  >
                    {requesting || isRunning(scan)
                      ? "Checking…"
                      : attempt?.uncertain
                        ? "Retry check"
                        : scan
                          ? "Check again"
                          : "Check skill"}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  disabled={add.isPending || (!canAdd && !uncertainImport)}
                  onClick={importSkill}
                >
                  {add.isPending
                    ? "Adding…"
                    : uncertainImport
                      ? "Retry adding"
                      : "Add to library"}
                </Button>
              </>
            ) : null}
            {resolve.isError && selection ? (
              <Button
                type="button"
                disabled={resolve.isPending}
                onClick={() => resolve.mutate(selection)}
              >
                Try again
              </Button>
            ) : null}
          </>
        ) : null
      }
    >
      {permissionLost ? (
        <p role="alert" className="text-sm text-amber-100">
          Your access changed. Sign in or refresh this page before continuing.
        </p>
      ) : !previewing ? (
        <>
          <SkillSearch
            value={search}
            onChange={setSearch}
            label="Search the catalog"
            placeholder="Find skills by name"
          />
          {Array.from(search.trim()).length === 1 ? (
            <p className="text-sm text-slate-400">
              Type at least two characters to search. Popular skills are shown
              below.
            </p>
          ) : null}
          <p className="text-xs text-slate-400">
            Catalog from Universal Agent Plugins. Check a skill before adding
            it.
          </p>
          {listing.isPending ? <p role="status">Loading skills…</p> : null}
          {listing.data?.pages[0]?.stale ? (
            <p className="text-sm text-amber-100">
              The catalog could not be refreshed. These results may be out of
              date.
            </p>
          ) : null}
          {!listing.isPending && !listing.isError && rows.length === 0 ? (
            <p role="status">No matching skills. Try another search.</p>
          ) : null}
          <ul
            className="divide-y divide-cyan-200/15"
            aria-label="Catalog skills"
          >
            {rows.map((item) => (
              <li
                key={item.id}
                className="flex min-w-0 flex-wrap items-center justify-between gap-3 py-3"
              >
                <div className="min-w-0 flex-1 basis-48">
                  <p className="break-words font-semibold text-cyan-50">
                    {item.title}
                  </p>
                  <p className="break-words text-sm text-slate-400">
                    {item.repository ?? "Source unavailable"}
                  </p>
                  {!item.available ? (
                    <p className="mt-1 text-xs text-slate-400">
                      Not available to add here
                    </p>
                  ) : null}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!item.available || !item.repository}
                  aria-label={`Preview ${item.title}`}
                  onClick={() => {
                    if (item.repository)
                      select({
                        repository: item.repository,
                        ...(item.skillNameHint
                          ? { skillNameHint: item.skillNameHint }
                          : {}),
                      });
                  }}
                >
                  Preview
                </Button>
              </li>
            ))}
          </ul>
          {listing.data?.pages[0]?.limited ? (
            <p className="text-xs text-slate-400">
              Showing a selection of matches. Refine your search to find more.
            </p>
          ) : null}
          {listing.hasNextPage ? (
            <Button
              type="button"
              variant="outline"
              disabled={listing.isFetchingNextPage}
              onClick={() => {
                void listing.fetchNextPage();
              }}
            >
              {listing.isFetchingNextPage ? "Loading…" : "Load more skills"}
            </Button>
          ) : null}
          {listing.isError ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                void listing.refetch();
              }}
            >
              Try again
            </Button>
          ) : null}
        </>
      ) : resolve.isPending ? (
        <p role="status">Opening skill…</p>
      ) : resolution?.status === "selection_required" ? (
        <section aria-label="Choose a skill" className="space-y-3">
          <h3 className="text-lg font-semibold text-cyan-50">
            Choose the skill to preview
          </h3>
          <p className="text-sm text-slate-400">
            This repository contains more than one matching skill.
          </p>
          <ul className="divide-y divide-cyan-200/15">
            {resolution.candidates.map((choice) => (
              <li
                key={choice.path}
                className="flex min-w-0 flex-wrap items-center justify-between gap-3 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="break-words text-cyan-50">{choice.name}</p>
                  <p className="break-words text-xs text-slate-400">
                    {choice.path || "Repository root"}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    select({
                      repository: resolution.repository,
                      commit: resolution.commit,
                      path: choice.path,
                    })
                  }
                >
                  Choose {choice.name}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : resolution?.status === "not_found" ||
        resolution?.status === "incomplete" ? (
        <p role="status" className="text-sm text-slate-300">
          {resolution.status === "not_found"
            ? "This skill is no longer available at its source. Choose another skill."
            : "The skill could not be fully opened. Choose another skill or try again later."}
        </p>
      ) : candidate ? (
        <>
          <section aria-label="Skill preview" className="space-y-3">
            <h3 className="break-words text-xl font-semibold text-cyan-50">
              {candidate.content.name}
            </h3>
            <p className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-300">
              {candidate.content.description}
            </p>
            <a
              href={`https://github.com/${candidate.source.repository}`}
              target="_blank"
              rel="noopener noreferrer"
              className="break-words text-sm text-cyan-200 underline"
            >
              {candidate.source.repository}
            </a>
          </section>
          <section
            aria-label="Skill check"
            className="space-y-3 border-y border-cyan-200/15 py-4"
          >
            {candidate.aiAvailable &&
            (configuration.data?.aiAvailable || mode === "ai") ? (
              <label className="flex items-start gap-3 text-sm text-slate-300">
                <Checkbox
                  checked={mode === "ai"}
                  disabled={profileLocked}
                  onChange={(event) => {
                    setMode(event.target.checked ? "ai" : "static");
                    setAcknowledgeWarnings(false);
                  }}
                />
                <span>
                  Include AI-assisted analysis
                  <span className="mt-1 block text-xs leading-5 text-slate-400">
                    The instructions will be sent to the configured analysis
                    service.
                  </span>
                </span>
              </label>
            ) : null}
            {mode === "ai" &&
            scanAvailable &&
            !configuration.data?.aiAvailable ? (
              <p role="status" className="text-sm text-amber-100">
                AI-assisted checks are currently unavailable. Turn off
                AI-assisted analysis to use the regular check.
              </p>
            ) : null}
            {!scanAvailable && scan && !configuration.isPending ? (
              <p role="status" className="text-sm text-amber-100">
                Checks are temporarily unavailable. Please try adding this skill
                again shortly.
              </p>
            ) : null}
            {uncertainImport ? (
              <p role="status" className="text-sm text-amber-100">
                Result not confirmed. The skill may already be in your library.
                Retry adding to recover the same result.
              </p>
            ) : attempt?.uncertain ? (
              <p role="status" className="text-sm text-amber-100">
                Result not confirmed. Retry check to recover the existing
                request.
              </p>
            ) : requesting || isRunning(scan) ? (
              <p role="status" className="text-sm text-cyan-100">
                Checking… You can close this window and return while it
                finishes.
              </p>
            ) : expired ? (
              <p role="status" className="text-sm text-amber-100">
                {candidate && Date.parse(candidate.expiresAt) <= now
                  ? "This preview expired. Open the skill again from the catalog."
                  : "Check this skill again before adding it."}
              </p>
            ) : exactScan && scan ? (
              <ScanResult scan={scan} />
            ) : !scanAvailable && !configuration.isPending ? (
              <p role="status" className="text-sm text-amber-100">
                Checks are temporarily unavailable. You can still read the
                instructions.
              </p>
            ) : (
              <p className="text-sm text-slate-300">
                Check this skill before adding it.
              </p>
            )}
            {eligible && scan?.verdict === "warnings" ? (
              <label className="flex items-start gap-3 text-sm text-slate-300">
                <Checkbox
                  checked={acknowledgeWarnings}
                  disabled={locked}
                  onChange={(event) =>
                    setAcknowledgeWarnings(event.target.checked)
                  }
                />
                <span>I reviewed the warnings and want to add this skill.</span>
              </label>
            ) : null}
            {scanQuery.isError ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  void scanQuery.refetch();
                }}
              >
                Refresh check
              </Button>
            ) : null}
          </section>
          {needsOmissions ? (
            <label className="flex items-start gap-3 text-sm text-slate-300">
              <Checkbox
                checked={acknowledgeOmissions}
                disabled={locked}
                onChange={(event) =>
                  setAcknowledgeOmissions(event.target.checked)
                }
              />
              <span>
                I understand that only these text instructions will be added.
                <span className="mt-1 block text-xs leading-5 text-slate-400">
                  Extra files and other setup details are not included.
                </span>
              </span>
            </label>
          ) : null}
          <details open className="space-y-3">
            <summary className="cursor-pointer text-sm font-semibold text-cyan-100">
              Read instructions
            </summary>
            <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-6 text-slate-300">
              {candidate.content.instructions}
            </pre>
          </details>
        </>
      ) : null}
    </SkillsDialog>
  );
}

function ScanResult({ scan }: { readonly scan: ReviewSkillScan }) {
  const title =
    scan.verdict === "clear"
      ? "No issues found"
      : scan.verdict === "warnings"
        ? "Review warnings"
        : scan.verdict === "blocked"
          ? "Risk found"
          : "Could not complete check";
  return (
    <div className="space-y-2">
      <p
        role="status"
        className={`text-sm font-semibold ${scan.verdict === "clear" ? "text-emerald-200" : "text-amber-100"}`}
      >
        {title}
      </p>
      <p className="text-xs leading-5 text-slate-400">
        {scan.verdict === "blocked"
          ? "This skill cannot be added because the check found a serious risk."
          : scan.verdict === "incomplete"
            ? "Check the skill again before adding it."
            : "Checks can miss risks. Review the instructions before adding them."}
      </p>
      {scan.findings.length ? (
        <details className="text-sm">
          <summary className="cursor-pointer text-cyan-100">
            Show findings ({scan.findings.length})
          </summary>
          <ul className="mt-3 space-y-3">
            {scan.findings.map((finding, index) => (
              <li
                key={index}
                className="space-y-1 border-l border-amber-200/30 pl-3"
              >
                <p className="whitespace-pre-wrap break-words text-slate-300">
                  {finding.explanation}
                </p>
                {finding.line !== null ? (
                  <p className="text-xs text-slate-400">Line {finding.line}</p>
                ) : null}
                {finding.remediation ? (
                  <p className="whitespace-pre-wrap break-words text-sm text-slate-400">
                    {finding.remediation}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
