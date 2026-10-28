"use client";
import { Button, Checkbox, SelectField } from "@reviewrouter/ui";
import type { ContextConnectionMetadata } from "@reviewrouter/features-review-context-tools";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { McpCatalogPreset } from "../../../src/features/context-tools/mcp-catalog";
import { McpCatalogPicker } from "./mcp-catalog-picker";
import {
  draftAuth,
  draftSecretNames,
  draftTools,
  draftValidation,
  parseConnectionDraft,
  namespaceNewDashboardBindings,
  type ConnectionDraft,
} from "./context-connection-draft";
import {
  contextProbeErrorMessage,
  saveContextConnectionRequest,
  testContextConnectionRequest,
  type DiscoveredContextTool,
} from "./context-connections-api";

const initialDefinition = {
  id: "",
  url: "",
  headers: {},
  tools: [],
  credentials: {},
};
const inputClass =
  "w-full min-w-0 rounded-lg border border-cyan-200/20 bg-slate-950 px-3 py-2 text-sm text-cyan-50 disabled:opacity-60";

export function ContextConnectionsForm({
  workspaceId,
  connections,
  catalog = [],
}: {
  workspaceId: string;
  connections: readonly ContextConnectionMetadata[];
  catalog?: readonly McpCatalogPreset[];
}): React.ReactElement {
  return (
    <div className="grid gap-8">
      {connections.map((connection) => (
        <ConnectionForm
          key={`${connection.id}:${connection.version}`}
          workspaceId={workspaceId}
          connection={connection}
        />
      ))}
      <ConnectionForm workspaceId={workspaceId} catalog={catalog} />
    </div>
  );
}

function ConnectionForm({
  workspaceId,
  connection,
  catalog = [],
}: {
  workspaceId: string;
  connection?: ContextConnectionMetadata;
  catalog?: readonly McpCatalogPreset[];
}): React.ReactElement {
  const router = useRouter();
  const headingId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const probeRef = useRef<{
    id: number;
    controller?: AbortController | undefined;
  }>({ id: 0 });
  const [definition, setDefinition] = useState(
    JSON.stringify(connection?.definition ?? initialDefinition, null, 2),
  );
  const [saving, setSaving] = useState(false);
  const [probing, setProbing] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [discovered, setDiscovered] = useState<DiscoveredContextTool[]>([]);
  const [manualTools, setManualTools] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [advancedAuth, setAdvancedAuth] = useState(false);
  const draft = parseConnectionDraft(definition);
  const auth = draftAuth(draft);
  const secretNames = draftSecretNames(draft);
  const selectedTools = draftTools(draft);
  const availableTools = [
    ...new Set([...discovered.map((tool) => tool.name), ...selectedTools]),
  ];
  useEffect(
    () => () => {
      probeRef.current.controller?.abort();
      probeRef.current.id++;
    },
    [],
  );

  function invalidateProbe(): void {
    probeRef.current.controller?.abort();
    probeRef.current = { id: probeRef.current.id + 1 };
    setProbing(false);
    setDiscovered([]);
    setNotice("");
    setError("");
  }
  function updateDefinition(next: string, keepDiscovery = false): void {
    if (!keepDiscovery) invalidateProbe();
    else {
      setNotice("");
      setError("");
    }
    setDefinition(next);
  }
  function patchDefinition(
    patch: ConnectionDraft,
    keepDiscovery = false,
  ): void {
    if (draft)
      updateDefinition(
        JSON.stringify({ ...draft, ...patch }, null, 2),
        keepDiscovery,
      );
  }
  function setAuthentication(mode: string): void {
    if (mode === "advanced") {
      setAdvancedAuth(true);
      setAdvancedOpen(true);
      return;
    }
    if (auth.mode === "advanced") return;
    setAdvancedAuth(false);
    if (mode === "none") patchDefinition({ headers: {}, credentials: {} });
    else if (auth.mode !== "bearer") {
      // Review plans flatten names. Namespace only this newly selected auth mode.
      const { headers, credentials } = namespaceNewDashboardBindings({
        id: typeof draft?.id === "string" ? draft.id : "mcp",
        url: typeof draft?.url === "string" ? draft.url : "",
        headers: { Authorization: "Bearer {{ secrets.API_KEY }}" },
        credentials: { API_KEY: { source: "dashboard-secret" } },
      });
      patchDefinition({ headers, credentials });
    }
  }
  function requestInput(requireTools: boolean) {
    const invalid = draftValidation(draft, connection?.id, requireTools);
    if (invalid) {
      setError(invalid);
      return null;
    }
    const fields = new FormData(formRef.current!);
    const secrets = Object.fromEntries(
      secretNames.map((name) => [
        name,
        String(fields.get(`secret.${name}`) ?? ""),
      ]),
    );
    const replacing = Object.values(secrets).some(Boolean);
    const stored =
      connection &&
      secretNames.every((name) =>
        connection.credentials.some(
          (item) =>
            item.name === name &&
            item.source === "dashboard-secret" &&
            item.present,
        ),
      );
    if (
      (replacing && Object.values(secrets).some((value) => !value.trim())) ||
      (!replacing && secretNames.length > 0 && !stored)
    ) {
      setError(
        "Enter every Dashboard secret. To retain stored values, leave every secret field empty.",
      );
      return null;
    }
    return {
      workspaceId,
      expectedVersion: connection?.version ?? null,
      definition: draft,
      ...(replacing ? { secrets } : {}),
    };
  }
  async function testConnection(): Promise<void> {
    const input = requestInput(false);
    if (!input) return;
    invalidateProbe();
    const controller = new AbortController();
    const id = probeRef.current.id;
    probeRef.current.controller = controller;
    setProbing(true);
    try {
      const result = await testContextConnectionRequest(
        input,
        controller.signal,
      );
      if (controller.signal.aborted || probeRef.current.id !== id) return;
      if (!result.ok) {
        setError(contextProbeErrorMessage(result.error));
        return;
      }
      setDiscovered(result.tools);
      setNotice(
        result.tools.length
          ? `Connection successful. Found ${result.tools.length} tools. Select the tools to approve, then save.`
          : "Connection successful. The server returned no tools. You can enter tool names manually.",
      );
    } catch {
      if (!controller.signal.aborted && probeRef.current.id === id)
        setError(contextProbeErrorMessage());
    } finally {
      if (probeRef.current.id === id) {
        setProbing(false);
        probeRef.current.controller = undefined;
      }
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const input = requestInput(true);
    if (!input) return;
    invalidateProbe();
    setSaving(true);
    try {
      const result = await saveContextConnectionRequest({
        ...input,
        enabled: new FormData(event.currentTarget).get("enabled") === "on",
      });
      if (!result.ok) {
        setError(
          result.conflict
            ? "Configuration changed. Reload before saving again."
            : result.error
              ? contextProbeErrorMessage(result.error)
              : "Could not save. Check the definition, secret bindings and workspace access.",
        );
        return;
      }
      if (!connection) {
        setDefinition(JSON.stringify(initialDefinition, null, 2));
        setManualTools("");
        setAdvancedAuth(false);
        setAdvancedOpen(false);
        formRef.current?.reset();
      }
      setNotice("Connection saved.");
      router.refresh();
    } catch {
      setError("Could not save. Try again after checking your connection.");
    } finally {
      for (const name of secretNames) {
        const field = formRef.current?.elements.namedItem(`secret.${name}`);
        if (field instanceof HTMLInputElement) field.value = "";
      }
      setSaving(false);
    }
  }
  function addTools(): void {
    const names = manualTools.split(/[\s,]+/).filter(Boolean);
    if (
      !names.length ||
      names.some((name) => !/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$/.test(name))
    ) {
      setError("Enter valid tool names separated by commas or spaces.");
      return;
    }
    const tools = [...new Set([...selectedTools, ...names])];
    if (tools.length > 20) {
      setError(
        "Approve no more than 20 tools per connection. Remove tools before adding more.",
      );
      return;
    }
    patchDefinition({ tools }, true);
    setManualTools("");
  }
  return (
    <form
      ref={formRef}
      aria-labelledby={headingId}
      onSubmit={submit}
      className="grid min-w-0 gap-5 border-t border-cyan-200/15 pt-6"
    >
      <div className="grid gap-1">
        <h2 id={headingId} className="text-lg font-semibold">
          {connection ? `${connection.id} connection` : "New connection"}
        </h2>
        <p className="text-xs text-slate-400">
          {connection
            ? `Revision ${connection.version}. Changes apply only when you save.`
            : "Connect an HTTPS MCP server, approve tools and save it for your workspace."}
        </p>
      </div>
      {!connection && catalog.length > 0 && (
        <McpCatalogPicker
          presets={catalog}
          disabled={saving}
          onSelect={(preset) => {
            updateDefinition(
              JSON.stringify(
                { ...namespaceNewDashboardBindings(preset), tools: [] },
                null,
                2,
              ),
            );
            setAdvancedAuth(false);
            setManualTools("");
            formRef.current?.reset();
          }}
        />
      )}
      <div className="grid min-w-0 gap-4 sm:grid-cols-2">
        <label className="grid gap-2 text-sm">
          Connection ID
          <input
            className={inputClass}
            value={typeof draft?.id === "string" ? draft.id : ""}
            placeholder="docs"
            maxLength={32}
            disabled={saving || !draft || !!connection}
            onChange={(event) => patchDefinition({ id: event.target.value })}
          />
          <span className="text-xs text-slate-400">
            {connection
              ? "The saved ID cannot change."
              : "Lowercase letters, numbers and underscores. Used in review policies."}
          </span>
        </label>
        <label className="grid gap-2 text-sm">
          HTTPS MCP URL
          <input
            className={inputClass}
            type="url"
            value={typeof draft?.url === "string" ? draft.url : ""}
            placeholder="https://mcp.example.com/mcp"
            maxLength={2048}
            disabled={saving || !draft}
            onChange={(event) => patchDefinition({ url: event.target.value })}
          />
          <span className="text-xs text-slate-400">
            Use the MCP endpoint supplied by your server.
          </span>
        </label>
      </div>
      <div className="grid gap-3">
        <SelectField
          name="authentication"
          label="Authentication"
          value={
            auth.mode === "advanced" || advancedAuth ? "advanced" : auth.mode
          }
          disabled={saving || !draft}
          onValueChange={setAuthentication}
          options={[
            {
              value: "none",
              label: "No authentication",
              disabled: auth.mode === "advanced",
            },
            {
              value: "bearer",
              label: "Bearer API key",
              disabled: auth.mode === "advanced",
            },
            { value: "advanced", label: "Custom headers (Advanced JSON)" },
          ]}
        />
        {auth.mode === "advanced" && (
          <p className="text-xs text-amber-200">
            This connection uses custom authentication or GitHub bindings. Edit
            them in Advanced JSON; guided edits preserve them.
          </p>
        )}
        {secretNames.map((name) => (
          <label key={name} className="grid gap-2 text-sm">
            {auth.mode === "bearer" && auth.secretName === name
              ? "API key"
              : name}{" "}
            {connection?.credentials.find((item) => item.name === name)?.present
              ? "(stored)"
              : "(required)"}
            <input
              className={inputClass}
              type="password"
              name={`secret.${name}`}
              autoComplete="new-password"
              maxLength={16384}
              disabled={saving}
              onChange={invalidateProbe}
            />
          </label>
        ))}
        {secretNames.length > 0 && (
          <p className="text-xs text-slate-400">
            Secret values stay separate from the definition. Leave every field
            empty to retain stored values. To replace them, enter every
            Dashboard secret. Changed endpoints or authentication require
            re-entry for testing and saving.
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          disabled={saving || probing || !draft}
          onClick={() => void testConnection()}
        >
          {probing ? "Testing connection..." : "Test connection"}
        </Button>
        {probing ? (
          <button
            type="button"
            onClick={invalidateProbe}
            className="text-sm text-cyan-200 underline"
          >
            Cancel test
          </button>
        ) : (
          <span className="text-xs text-slate-400">
            Discovers tools without saving or invoking them.
          </span>
        )}
      </div>
      {notice && (
        <p role="status" className="text-sm text-cyan-100">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-amber-200">
          {error}
        </p>
      )}
      <fieldset
        disabled={saving || !draft}
        className="grid min-w-0 gap-3 border-t border-cyan-200/10 pt-4"
      >
        <legend className="text-sm font-semibold">Approved tools</legend>
        <p className="text-xs text-slate-400">
          Choose only the tools reviews may use. Nothing is approved
          automatically. You can also enter exact tool names if discovery is
          unavailable.
        </p>
        {availableTools.map((name) => (
          <label key={name} className="flex min-w-0 items-start gap-3 text-sm">
            <Checkbox
              aria-label={name}
              disabled={
                selectedTools.length >= 20 && !selectedTools.includes(name)
              }
              checked={selectedTools.includes(name)}
              onChange={(event) =>
                patchDefinition(
                  {
                    tools: event.target.checked
                      ? [...selectedTools, name]
                      : selectedTools.filter((tool) => tool !== name),
                  },
                  true,
                )
              }
            />
            <span className="min-w-0 break-words">
              <span className="font-mono">{name}</span>
              {discovered.find((tool) => tool.name === name)?.description && (
                <span className="mt-1 block text-xs text-slate-400">
                  {discovered.find((tool) => tool.name === name)?.description}
                </span>
              )}
            </span>
          </label>
        ))}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="grid min-w-0 flex-1 gap-2 text-sm">
            Tool names
            <input
              className={inputClass}
              value={manualTools}
              placeholder="search_docs, fetch_page"
              maxLength={8192}
              onChange={(event) => setManualTools(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addTools();
                }
              }}
            />
          </label>
          <Button type="button" variant="outline" onClick={addTools}>
            Add tools
          </Button>
        </div>
        <p className="text-xs text-slate-400">
          {selectedTools.length} tool{selectedTools.length === 1 ? "" : "s"}{" "}
          approved. Approve between 1 and 20 tools before saving.
        </p>
      </fieldset>
      <details
        open={advancedOpen || auth.mode === "advanced"}
        onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
        className="min-w-0 border-t border-cyan-200/10 pt-4"
      >
        <summary className="cursor-pointer text-sm font-medium text-cyan-200">
          Advanced JSON
        </summary>
        <label className="mt-3 grid gap-2 text-sm">
          Connection definition
          <textarea
            aria-label={
              connection
                ? `${connection.id} definition`
                : "New connection definition"
            }
            className={`${inputClass} font-mono text-xs`}
            rows={10}
            maxLength={24576}
            value={definition}
            onChange={(event) => updateDefinition(event.target.value)}
            disabled={saving}
            spellCheck={false}
          />
        </label>
        <p className="mt-2 text-xs text-slate-400">
          Guided controls and JSON edit the same definition. Use named templates
          such as {"{{ secrets.API_KEY }}"} in headers, with{" "}
          {'{"source":"dashboard-secret"}'} or{" "}
          {'{"source":"github-secret","name":"EXACT_GITHUB_SECRET_NAME"}'}{" "}
          bindings. Never paste secret values here.
        </p>
      </details>
      <label className="flex items-center gap-3 text-sm">
        <Checkbox
          name="enabled"
          defaultChecked={connection?.enabled ?? true}
          disabled={saving}
        />
        Enabled for policy selection
      </label>
      <Button
        type="submit"
        disabled={saving || probing || !draft}
        className="w-fit"
      >
        {saving ? "Saving..." : "Save connection"}
      </Button>
    </form>
  );
}
