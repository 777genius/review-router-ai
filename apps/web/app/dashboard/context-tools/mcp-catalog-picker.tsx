"use client";

import { useState } from "react";
import { Button, SelectField } from "@reviewrouter/ui";
import type {
  McpCatalogConnection,
  McpCatalogPreset,
} from "../../../src/features/context-tools/mcp-catalog";

export function McpCatalogPicker({
  presets,
  onSelect,
  disabled = false,
}: {
  presets: readonly McpCatalogPreset[];
  onSelect: (connection: McpCatalogConnection) => void;
  disabled?: boolean;
}): React.ReactElement {
  const [selectedId, setSelectedId] = useState("");
  const selected = presets.find((preset) => preset.id === selectedId);
  return (
    <div className="grid gap-3 border-b border-cyan-200/15 pb-5">
      <SelectField
        name="mcp-catalog-preset"
        label="Start from the UAP catalog"
        value={selectedId}
        disabled={disabled}
        options={[
          { value: "", label: "Choose a registry preset" },
          ...presets.map((preset) => ({
            value: preset.id,
            label: `${preset.name}${preset.compatibility.status === "unsupported" ? " (unsupported)" : ""}`,
          })),
        ]}
        onValueChange={setSelectedId}
      />
      {selected && (
        <div className="grid gap-2 text-sm text-slate-400">
          <p>{selected.description}</p>
          <p>
            <a
              className="text-cyan-200 underline"
              href={selected.catalogUrl}
              target="_blank"
              rel="noreferrer"
            >
              UAP catalog
            </a>{" "}
            ·{" "}
            <a
              className="text-cyan-200 underline"
              href={selected.sourceUrl}
              target="_blank"
              rel="noreferrer"
            >
              Package source
            </a>
            · {selected.distributionId} · release {selected.releaseSequence} · v
            {selected.packageVersion}
          </p>
          {selected.compatibility.status === "unsupported" ? (
            <p role="status">{selected.compatibility.reason}</p>
          ) : (
            <>
              <p>
                {selected.compatibility.authentication === "none"
                  ? "The pinned OpenCode release policy says authentication is not required. Service access and usage limits still apply."
                  : "Enter the API credentials in the secret fields after choosing this preset."}{" "}
                Discover the server's tools and approve the tools this
                connection may use before saving.
              </p>
              <Button
                type="button"
                className="w-fit"
                disabled={disabled}
                onClick={() => {
                  if (selected.compatibility.status === "supported") {
                    onSelect(
                      structuredClone(selected.compatibility.connection),
                    );
                  }
                }}
              >
                Use {selected.name}
              </Button>
            </>
          )}
        </div>
      )}
      <p className="text-xs text-slate-400">
        Reviewed remote HTTPS MCP presets only. Choosing a preset fills
        connection fields; it does not install a plugin or authorize tools.
      </p>
    </div>
  );
}
