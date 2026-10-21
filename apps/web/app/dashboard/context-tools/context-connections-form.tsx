"use client";
import { Button } from "@reviewrouter/ui";
import type { ContextConnectionMetadata } from "@reviewrouter/features-review-context-tools";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

const initialDefinition = {
  id: "docs",
  url: "https://mcp.example.com/mcp",
  headers: { Authorization: "Bearer {{ secrets.DOCS_KEY }}" },
  tools: ["search_docs"],
  credentials: { DOCS_KEY: { source: "dashboard-secret" } },
};
const inputClass =
  "w-full rounded-lg border border-cyan-200/20 bg-slate-950 px-3 py-2 text-sm text-cyan-50";

export function ContextConnectionsForm({
  workspaceId,
  connections,
}: {
  workspaceId: string;
  connections: readonly ContextConnectionMetadata[];
}): React.ReactElement {
  return (
    <div className="grid gap-6">
      {connections.map((connection) => (
        <ConnectionForm
          key={`${connection.id}:${connection.version}`}
          workspaceId={workspaceId}
          connection={connection}
        />
      ))}
      <ConnectionForm workspaceId={workspaceId} />
    </div>
  );
}

function ConnectionForm({
  workspaceId,
  connection,
}: {
  workspaceId: string;
  connection?: ContextConnectionMetadata;
}): React.ReactElement {
  const router = useRouter();
  const [definition, setDefinition] = useState(
    JSON.stringify(connection?.definition ?? initialDefinition, null, 2),
  );
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  let secretNames: string[] = [];
  try {
    const parsed: unknown = JSON.parse(definition);
    if (
      parsed &&
      typeof parsed === "object" &&
      "credentials" in parsed &&
      parsed.credentials &&
      typeof parsed.credentials === "object"
    ) {
      secretNames = Object.entries(parsed.credentials)
        .filter(
          ([name, value]) =>
            /^[A-Z][A-Z0-9_]{0,63}$/.test(name) &&
            value?.source === "dashboard-secret",
        )
        .map(([name]) => name)
        .slice(0, 20);
    }
  } catch {
    /* The server validates the complete definition on save. */
  }
  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    setBusy(true);
    setNotice("");
    try {
      const secrets = Object.fromEntries(
        secretNames.map((name) => [
          name,
          String(fields.get(`secret.${name}`) ?? ""),
        ]),
      );
      const replaceSecrets = Object.values(secrets).some(Boolean);
      const response = await fetch("/api/dashboard/context-tools", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          expectedVersion: connection?.version ?? null,
          definition: JSON.parse(definition),
          enabled: fields.get("enabled") === "on",
          ...(replaceSecrets ? { secrets } : {}),
        }),
      });
      if (!response.ok) {
        setNotice(
          response.status === 409
            ? "Configuration changed. Reload before saving again."
            : "Could not save. Check the definition, secret bindings and workspace access.",
        );
        return;
      }
      setNotice("Connection saved.");
      router.refresh();
    } catch {
      setNotice("Could not save. Check the JSON definition and try again.");
    } finally {
      for (const name of secretNames) {
        const input = form.elements.namedItem(`secret.${name}`);
        if (input instanceof HTMLInputElement) input.value = "";
      }
      setBusy(false);
    }
  }
  return (
    <form
      onSubmit={submit}
      className="grid gap-3 border-t border-cyan-200/15 pt-5"
    >
      <h2 className="text-lg font-semibold">
        {connection
          ? `${connection.id} · revision ${connection.version}`
          : "Add connection"}
      </h2>
      <label className="grid gap-2 text-sm">
        Definition (id, HTTPS URL, header templates, approved tools, credential
        bindings)
        <textarea
          aria-label={
            connection
              ? `${connection.id} definition`
              : "New connection definition"
          }
          className={`${inputClass} font-mono`}
          rows={12}
          maxLength={24576}
          value={definition}
          onChange={(event) => setDefinition(event.target.value)}
          disabled={busy}
          spellCheck={false}
        />
      </label>
      <p className="text-xs text-slate-400">
        Use only named header templates such as {"{{ secrets.DOCS_KEY }}"}. A
        binding uses {'{"source":"dashboard-secret"}'} or{" "}
        {'{"source":"github-secret","name":"EXACT_GITHUB_SECRET_NAME"}'}. Never
        paste credentials into the definition.
      </p>
      {secretNames.map((name) => (
        <label key={name} className="grid gap-1 text-sm">
          {name}{" "}
          {connection?.credentials.find((item) => item.name === name)?.present
            ? "(stored)"
            : "(required)"}
          <input
            className={inputClass}
            type="password"
            name={`secret.${name}`}
            autoComplete="new-password"
            maxLength={16384}
            disabled={busy}
          />
        </label>
      ))}
      {secretNames.length > 0 && (
        <p className="text-xs text-slate-400">
          Leave every secret field empty to retain stored values. To replace
          secrets, enter every Dashboard secret for this connection.
        </p>
      )}
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="enabled"
          defaultChecked={connection?.enabled ?? true}
          disabled={busy}
        />
        Enabled for policy selection
      </label>
      {notice && (
        <p role="status" className="text-sm">
          {notice}
        </p>
      )}
      <Button type="submit" disabled={busy} className="w-fit">
        {busy ? "Saving..." : "Save connection"}
      </Button>
    </form>
  );
}
