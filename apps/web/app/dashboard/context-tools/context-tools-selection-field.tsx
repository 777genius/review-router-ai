"use client";
import { useState } from "react";
import type {
  ContextConnectionMetadata,
  ContextToolsSelection,
} from "@reviewrouter/features-review-context-tools";

export function ContextToolsSelectionField({
  value,
  connections,
  disabled,
  repositoryTarget,
}: {
  repositoryTarget?: { workspaceId: string; repositoryId: string } | undefined;
  value: ContextToolsSelection | undefined;
  connections: readonly ContextConnectionMetadata[];
  disabled: boolean;
}): React.ReactElement {
  const [selection, setSelection] = useState<ContextToolsSelection>(
    value ?? { version: 1, builtinTools: [], mcp: [] },
  );
  const [importing, setImporting] = useState(false);
  const [importNotice, setImportNotice] = useState("");
  async function importPreview(): Promise<void> {
    if (!repositoryTarget) return;
    setImporting(true);
    try {
      const response = await fetch(
        `/api/dashboard/context-tools/import?${new URLSearchParams(repositoryTarget)}`,
      );
      if (!response.ok) throw new Error();
      const preview: {
        selection: ContextToolsSelection;
        sourceCommit: string;
      } = await response.json();
      setSelection(preview.selection);
      setImportNotice(
        `Preview from default branch commit ${preview.sourceCommit}. Review the selection and save this policy to apply it.`,
      );
    } catch {
      setImportNotice(
        "Could not import. Check the default-branch .reviewrouter.json, workspace access and approved connections.",
      );
    } finally {
      setImporting(false);
    }
  }
  const builtinTools = ["github.issue.read", "repository.docs.read"] as const;
  return (
    <fieldset
      disabled={disabled}
      className="grid gap-3 border-t border-cyan-200/10 pt-4"
    >
      <legend className="text-sm font-semibold">Context tools</legend>
      <p className="text-xs text-slate-400">
        Optional read-only review context for OpenCodeReview through Account
        Gateway with Agentic context enabled. Select approved tools from enabled
        workspace connections.
      </p>
      {repositoryTarget && (
        <button
          type="button"
          disabled={importing}
          onClick={() => void importPreview()}
          className="w-fit text-sm text-cyan-200 underline"
        >
          {importing
            ? "Importing preview..."
            : "Import from default-branch config"}
        </button>
      )}
      {importNotice && (
        <p role="status" className="text-xs text-slate-400">
          {importNotice}
        </p>
      )}
      <input
        type="hidden"
        name="contextTools"
        value={
          selection.builtinTools.length || selection.mcp.length
            ? JSON.stringify(selection)
            : ""
        }
      />
      {builtinTools.map((tool) => (
        <label key={tool} className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={selection.builtinTools.includes(tool)}
            onChange={(event) =>
              setSelection((previous) => ({
                ...previous,
                builtinTools: event.target.checked
                  ? [...previous.builtinTools, tool]
                  : previous.builtinTools.filter((item) => item !== tool),
              }))
            }
          />
          {tool}
        </label>
      ))}
      {connections
        .filter((connection) => connection.enabled)
        .map((connection) => (
          <div key={connection.id} className="grid gap-2">
            <span className="text-sm font-medium">{connection.id}</span>
            {connection.definition.tools.map((tool) => (
              <label key={tool} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={selection.mcp.some(
                    (item) =>
                      item.connection === connection.id &&
                      item.tools.includes(tool),
                  )}
                  onChange={(event) =>
                    setSelection((previous) => {
                      const current =
                        previous.mcp.find(
                          (item) => item.connection === connection.id,
                        )?.tools ?? [];
                      const tools = event.target.checked
                        ? [...current, tool]
                        : current.filter((item) => item !== tool);
                      return {
                        ...previous,
                        mcp: [
                          ...previous.mcp.filter(
                            (item) => item.connection !== connection.id,
                          ),
                          ...(tools.length
                            ? [{ connection: connection.id, tools }]
                            : []),
                        ],
                      };
                    })
                  }
                />
                {tool}
              </label>
            ))}
          </div>
        ))}
      {selection.mcp.some(
        (item) =>
          !connections.some(
            (connection) =>
              connection.enabled &&
              connection.id === item.connection &&
              item.tools.every((tool) =>
                connection.definition.tools.includes(tool),
              ),
          ),
      ) && (
        <p role="alert" className="text-sm text-amber-200">
          A selected connection or tool is unavailable. Remove it by clearing
          context tools, or restore the workspace connection before saving.
        </p>
      )}
      <button
        type="button"
        onClick={() => setSelection({ version: 1, builtinTools: [], mcp: [] })}
        className="w-fit text-sm text-cyan-200 underline"
      >
        Clear context tools
      </button>
    </fieldset>
  );
}
