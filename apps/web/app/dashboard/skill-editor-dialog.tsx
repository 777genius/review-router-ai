"use client";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@reviewrouter/ui";
import type { ReviewSkillDocument } from "../../src/features/review-skills/contracts";
import {
  requestReviewSkills,
  ReviewSkillsClientError,
} from "../../src/features/review-skills/client-adapter";
import { SkillsDialog, SkillsError, skillFieldClass } from "./review-skills-ui";

type SkillContent = Pick<
  ReviewSkillDocument,
  "name" | "description" | "instructions"
>;

function exportSkill(document: SkillContent) {
  const text = `---\nname: ${JSON.stringify(document.name)}\ndescription: ${JSON.stringify(document.description)}\n---\n${document.instructions}`;
  const url = URL.createObjectURL(
    new Blob([text], { type: "text/markdown;charset=utf-8" }),
  );
  const link = globalThis.document.createElement("a");
  link.href = url;
  link.download = "SKILL.md";
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
  const valid =
    name.trim() &&
    instructions.trim() &&
    Array.from(name).length <= 120 &&
    Array.from(description).length <= 1024 &&
    bytes <= 32768;
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
  const fieldsLocked = save.isPending || importing || Boolean(uncertainCreate);
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
  async function importFile(file: File | undefined) {
    if (!file) return;
    setImporting(true);
    try {
      // Bound parsing while leaving room for the YAML header around a valid
      // 32 KiB body, including escaped name and description characters.
      if (file.size > 64 * 1024)
        throw new Error(
          "SKILL.md must be 64 KiB or smaller; instructions are limited to 32 KiB.",
        );
      const text = await file.text();
      const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(
        text,
      );
      if (!match)
        throw new Error(
          "Use SKILL.md with YAML name and description, followed by Markdown instructions.",
        );
      const { parseDocument, isAlias, isMap, isSeq } = await import("yaml");
      const yaml = parseDocument(match[1]!, {
        schema: "failsafe",
        uniqueKeys: true,
      });
      const inspect = (node: unknown): void => {
        if (
          isAlias(node) ||
          (node && typeof node === "object" && "tag" in node && node.tag)
        )
          throw new Error("YAML aliases and explicit tags are unsupported.");
        if (isMap(node))
          for (const item of node.items) {
            inspect(item.key);
            inspect(item.value);
          }
        if (isSeq(node)) for (const item of node.items) inspect(item);
      };
      inspect(yaml.contents);
      if (yaml.errors.length || yaml.warnings.length)
        throw new Error("The YAML header could not be imported safely.");
      const fields = yaml.toJS({ maxAliasCount: 0 }) as Record<string, unknown>;
      if (
        !fields ||
        typeof fields.name !== "string" ||
        typeof fields.description !== "string"
      )
        throw new Error(
          "The YAML header needs text name and description fields.",
        );
      setName(fields.name);
      setDescription(fields.description);
      setInstructions(match[2]!);
      setImportError(null);
    } catch (error) {
      setImportError(error);
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
        <>
          {document || dirty ? (
            <Button
              type="button"
              variant="outline"
              className="max-w-full"
              onClick={() => exportSkill({ name, description, instructions })}
            >
              Export SKILL.md
            </Button>
          ) : null}
          {editable ? (
            <Button
              type="button"
              disabled={
                !valid ||
                save.isPending ||
                importing ||
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
          maxLength={240}
          onChange={(event) => setName(event.target.value)}
          required
        />
        <span className="mt-1 block text-xs text-slate-500">
          {Array.from(name).length}/120 characters
        </span>
      </label>
      <label className="block text-sm text-slate-300">
        Description
        <textarea
          className={`${skillFieldClass} mt-2`}
          rows={2}
          value={description}
          readOnly={!editable}
          disabled={fieldsLocked}
          onChange={(event) => setDescription(event.target.value)}
        />
        <span className="mt-1 block text-xs text-slate-500">
          {Array.from(description).length}/1024 characters
        </span>
      </label>
      <label className="block text-sm text-slate-300">
        Markdown instructions
        <textarea
          className={`${skillFieldClass} mt-2 min-h-64 font-mono leading-6`}
          rows={12}
          value={instructions}
          readOnly={!editable}
          disabled={fieldsLocked}
          onChange={(event) => setInstructions(event.target.value)}
          required
        />
        <span className="mt-1 block text-xs text-slate-500">
          {bytes}/32768 UTF-8 bytes. Instructions are text; no scripts or
          dependencies are installed.
        </span>
      </label>
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
