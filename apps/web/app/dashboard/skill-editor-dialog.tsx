"use client";
import { useId, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@reviewrouter/ui";
import type { ReviewSkillDocument } from "../../src/features/review-skills/contracts";
import {
  requestReviewSkills,
  ReviewSkillsClientError,
} from "../../src/features/review-skills/client-adapter";
import { SkillsDialog, SkillsError, skillFieldClass } from "./review-skills-ui";
import {
  parseSkillImport,
  skillContentIssues,
  skillDownload,
  skillImportByteLimit,
  type SkillImport,
} from "../../src/features/review-skills/portable-skill";

type SkillContent = Pick<
  ReviewSkillDocument,
  "name" | "description" | "instructions"
>;

function exportSkill(download: ReturnType<typeof skillDownload>) {
  const url = URL.createObjectURL(
    new Blob([download.text], { type: "text/markdown;charset=utf-8" }),
  );
  const link = globalThis.document.createElement("a");
  link.href = url;
  link.download = download.filename;
  link.click();
  URL.revokeObjectURL(url);
}
export function SkillEditorDialog({
  workspaceId,
  document,
  onClose,
  onSaved,
}: {
  readonly workspaceId: string;
  readonly document?: ReviewSkillDocument;
  readonly onClose: () => void;
  readonly onSaved: (document: ReviewSkillDocument) => void;
}) {
  const [name, setName] = useState(document?.name ?? "");
  const [description, setDescription] = useState(document?.description ?? "");
  const [instructions, setInstructions] = useState(
    document?.instructions ?? "",
  );
  const [savedContent, setSavedContent] = useState<SkillContent>(() => ({
    name: document?.name ?? "",
    description: document?.description ?? "",
    instructions: document?.instructions ?? "",
  }));
  const [revisionId, setRevisionId] = useState(document?.revisionId ?? "");
  const [importError, setImportError] = useState<unknown>(null);
  const [importReview, setImportReview] = useState<SkillImport | null>(null);
  const [touched, setTouched] = useState<
    Partial<Record<keyof SkillContent, boolean>>
  >({});
  const fieldId = useId();
  const [comparison, setComparison] = useState<ReviewSkillDocument | null>(
    null,
  );
  const [reconciled, setReconciled] = useState(false);
  const [createOperationId] = useState(() =>
    document ? "" : crypto.randomUUID(),
  );
  const [uncertainCreate, setUncertainCreate] = useState<SkillContent | null>(
    null,
  );
  const [importing, setImporting] = useState(false);
  const editable = !document || document.canEdit;
  const dirty =
    name !== savedContent.name ||
    description !== savedContent.description ||
    instructions !== savedContent.instructions;
  const bytes = new TextEncoder().encode(instructions).length;
  const issues = skillContentIssues({ name, description, instructions });
  const valid = Object.keys(issues).length === 0;
  const download = skillDownload({ name, description, instructions });
  const save = useMutation({
    mutationFn: (content: SkillContent) =>
      document
        ? requestReviewSkills("saveSkill", {
            workspaceId: document.sourceWorkspaceId,
            skillId: document.skillId,
            expectedRevisionId: revisionId,
            content,
          })
        : requestReviewSkills("createSkill", {
            workspaceId,
            createOperationId,
            content,
          }),
    onSuccess: onSaved,
    onError: (error, submitted) => {
      if (
        !document &&
        error instanceof ReviewSkillsClientError &&
        error.code === "unknown"
      )
        setUncertainCreate(submitted);
    },
  });
  const fieldsLocked =
    save.isPending ||
    importing ||
    Boolean(uncertainCreate) ||
    Boolean(importReview);
  const close = () => {
    if (
      !save.isPending &&
      !importing &&
      (!editable ||
        (!dirty && !uncertainCreate) ||
        window.confirm(
          uncertainCreate
            ? "This skill may already have been created. Close and check the Skills library before creating it again?"
            : "Discard your unsaved skill changes?",
        ))
    )
      onClose();
  };
  function applyImport(imported: SkillImport) {
    setName(imported.content.name);
    setDescription(imported.content.description);
    setInstructions(imported.content.instructions);
    setImportReview(null);
    setImportError(null);
    setTouched({});
  }
  async function importFile(file: File | undefined) {
    if (!file) return;
    setImporting(true);
    try {
      // Bound parsing while leaving room for the YAML header around a valid
      // 32 KiB body, including escaped name and description characters.
      if (file.size > skillImportByteLimit)
        throw new Error(
          "SKILL.md must be 64 KiB or smaller; instructions are limited to 32 KiB.",
        );
      const imported = await parseSkillImport(await file.text());
      setImportError(null);
      if (dirty || imported.omittedFields.length) setImportReview(imported);
      else applyImport(imported);
    } catch (error) {
      setImportError(
        new Error(
          `Import not applied. Your current draft is unchanged. ${error instanceof Error ? error.message : "SKILL.md could not be imported."}`,
        ),
      );
    } finally {
      setImporting(false);
    }
  }
  const conflict =
    save.error instanceof ReviewSkillsClientError &&
    save.error.code === "conflict";
  return (
    <SkillsDialog
      open
      onClose={close}
      pending={save.isPending || importing}
      title={
        document ? (editable ? "Edit skill" : "View skill") : "Create skill"
      }
      description="Save updates these instructions for future reviews in connected repositories. Reviews already in progress keep the instructions they started with."
      footer={
        importReview ? (
          <>
            <Button
              type="button"
              variant="outline"
              onClick={() => setImportReview(null)}
            >
              Cancel import
            </Button>
            <Button type="button" onClick={() => applyImport(importReview)}>
              {importReview.omittedFields.length
                ? "Import text only"
                : "Replace draft"}
            </Button>
          </>
        ) : (
          <>
            {document || dirty ? (
              <Button
                type="button"
                variant="outline"
                className="max-w-full"
                onClick={() => exportSkill(download)}
              >
                {download.issue ? "Download draft" : "Export SKILL.md"}
              </Button>
            ) : null}
            {editable ? (
              <Button
                type="button"
                disabled={
                  !valid ||
                  save.isPending ||
                  importing ||
                  Boolean(importReview) ||
                  (conflict && !reconciled)
                }
                onClick={() => {
                  setImportError(null);
                  save.mutate(
                    uncertainCreate ?? { name, description, instructions },
                  );
                }}
              >
                {save.isPending
                  ? "Saving…"
                  : uncertainCreate
                    ? "Retry save"
                    : "Save"}
              </Button>
            ) : null}
          </>
        )
      }
    >
      {!document ? (
        <label className="block text-sm text-slate-400">
          Import SKILL.md (optional)
          <input
            type="file"
            accept=".md,text/markdown,text/plain"
            disabled={fieldsLocked}
            className="mt-2 block w-full text-sm"
            onChange={(event) => {
              void importFile(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
        </label>
      ) : null}
      {importing ? <p role="status">Importing SKILL.md…</p> : null}
      {importReview ? (
        <section
          aria-label="Review import"
          className="space-y-2 border-y border-cyan-200/20 py-3 text-sm"
        >
          <h3 className="font-semibold text-cyan-50">Review import</h3>
          <p className="break-words text-slate-300">
            Importing {importReview.content.name} as editable text instructions.
          </p>
          {importReview.omittedFields.length ? (
            <p className="text-amber-100">
              This editor does not store these fields:{" "}
              {importReview.omittedFields.join(", ")}. Import text only keeps
              the name, description and Markdown instructions.
            </p>
          ) : null}
          {dirty ? (
            <p className="text-amber-100">
              Importing will replace your current unsaved draft. Cancel import
              keeps it unchanged.
            </p>
          ) : null}
        </section>
      ) : null}
      {uncertainCreate ? (
        <p role="status" className="text-sm text-amber-100">
          This skill may already have been created. Retry save recovers the
          result using the same submitted content without creating a second
          original.
        </p>
      ) : null}
      {!editable ? (
        <p className="text-sm text-slate-400">
          Only the original author with current source workspace membership can
          edit this skill.
        </p>
      ) : null}
      <label className="block text-sm text-slate-300">
        Name
        <input
          className={`${skillFieldClass} mt-2`}
          value={name}
          readOnly={!editable}
          disabled={fieldsLocked}
          aria-invalid={Boolean(touched.name && issues.name)}
          aria-describedby={`${fieldId}-name-hint ${touched.name && issues.name ? `${fieldId}-name-error` : ""}`}
          maxLength={240}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => setTouched((current) => ({ ...current, name: true }))}
          required
        />
        <span
          id={`${fieldId}-name-hint`}
          className="mt-1 block text-xs text-slate-500"
        >
          {Array.from(name).length}/120 characters
        </span>
        {touched.name && issues.name ? (
          <span
            id={`${fieldId}-name-error`}
            className="mt-1 block text-xs text-amber-100"
          >
            {issues.name}
          </span>
        ) : null}
      </label>
      <label className="block text-sm text-slate-300">
        Description
        <textarea
          className={`${skillFieldClass} mt-2`}
          rows={2}
          value={description}
          readOnly={!editable}
          disabled={fieldsLocked}
          aria-invalid={Boolean(touched.description && issues.description)}
          aria-describedby={`${fieldId}-description-hint ${touched.description && issues.description ? `${fieldId}-description-error` : ""}`}
          onChange={(event) => setDescription(event.target.value)}
          onBlur={() =>
            setTouched((current) => ({ ...current, description: true }))
          }
        />
        <span
          id={`${fieldId}-description-hint`}
          className="mt-1 block text-xs text-slate-500"
        >
          {Array.from(description).length}/1024 characters
        </span>
        {touched.description && issues.description ? (
          <span
            id={`${fieldId}-description-error`}
            className="mt-1 block text-xs text-amber-100"
          >
            {issues.description}
          </span>
        ) : null}
      </label>
      <label className="block text-sm text-slate-300">
        Markdown instructions
        <textarea
          className={`${skillFieldClass} mt-2 min-h-64 font-mono leading-6`}
          rows={12}
          value={instructions}
          readOnly={!editable}
          disabled={fieldsLocked}
          aria-invalid={Boolean(touched.instructions && issues.instructions)}
          aria-describedby={`${fieldId}-instructions-hint ${touched.instructions && issues.instructions ? `${fieldId}-instructions-error` : ""}`}
          onChange={(event) => setInstructions(event.target.value)}
          onBlur={() =>
            setTouched((current) => ({ ...current, instructions: true }))
          }
          required
        />
        <span
          id={`${fieldId}-instructions-hint`}
          className="mt-1 block text-xs text-slate-500"
        >
          {bytes}/32768 UTF-8 bytes. Instructions are text; no scripts or
          dependencies are installed.
        </span>
        {touched.instructions && issues.instructions ? (
          <span
            id={`${fieldId}-instructions-error`}
            className="mt-1 block text-xs text-amber-100"
          >
            {issues.instructions}
          </span>
        ) : null}
      </label>
      {document || dirty ? (
        <div className="space-y-1 break-words text-xs leading-5 text-slate-400">
          {download.issue ? (
            <p>Download draft preserves your text. {download.issue}</p>
          ) : (
            <>
              <p>
                Text-only export: place SKILL.md in a folder named{" "}
                {download.portableName}. Your name in this library stays
                unchanged.
              </p>
              {download.usesFallbackDescription ? (
                <p>Export description: {download.exportDescription}</p>
              ) : null}
            </>
          )}
        </div>
      ) : null}
      <SkillsError error={importError ?? save.error} />
      {conflict ? (
        <Button
          type="button"
          variant="outline"
          disabled={fieldsLocked}
          onClick={() => {
            if (document)
              void requestReviewSkills("loadSkill", {
                workspaceId: document.sourceWorkspaceId,
                skillId: document.skillId,
              })
                .then((current) => {
                  setComparison(current);
                  setReconciled(false);
                  setImportError(null);
                })
                .catch(setImportError);
          }}
        >
          Keep draft and compare with current revision
        </Button>
      ) : null}
      {comparison ? (
        <section
          aria-label="Current saved revision"
          className="space-y-3 border-t border-cyan-200/20 pt-4"
        >
          <h3 className="font-semibold">
            Current saved revision {comparison.revisionNumber}
          </h3>
          <p className="text-sm text-slate-300">{comparison.name}</p>
          <p className="text-sm text-slate-400">{comparison.description}</p>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-950 p-3 text-xs text-slate-300">
            {comparison.instructions}
          </pre>
          <p className="text-sm text-slate-400">
            Your draft remains above. Compare it with this saved revision before
            choosing how to proceed.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              variant="outline"
              disabled={fieldsLocked}
              onClick={() => {
                setName(comparison.name);
                setDescription(comparison.description);
                setInstructions(comparison.instructions);
                setRevisionId(comparison.revisionId);
                setSavedContent(comparison);
                setReconciled(true);
                setComparison(null);
                save.reset();
              }}
            >
              Use current saved content
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={fieldsLocked}
              onClick={() => {
                setRevisionId(comparison.revisionId);
                setSavedContent(comparison);
                setReconciled(true);
                setComparison(null);
                save.reset();
              }}
            >
              Keep reconciled draft
            </Button>
          </div>
        </section>
      ) : null}
    </SkillsDialog>
  );
}
