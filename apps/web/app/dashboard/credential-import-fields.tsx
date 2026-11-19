"use client";

import { useRef, useState } from "react";
import type { CredentialImportMethod } from "../../src/features/account-gateway/connection-capabilities";

export const credentialImportLabels: Record<CredentialImportMethod, string> = {
  refresh_token: "Refresh token",
  oauth_auth_json: "Codex auth.json",
};
export function validCredentialImportText(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 65536 &&
    !/\p{Cs}/u.test(value) &&
    new TextEncoder().encode(value).byteLength <= 65536
  );
}
/** Opaque text remains in uncontrolled inputs and the one-off submission closure. */
export function CredentialImportFields({
  method,
  loading,
}: {
  method: CredentialImportMethod;
  loading(value: boolean): void;
}) {
  const text = useRef<HTMLTextAreaElement>(null);
  const generation = useRef(0);
  const [error, setError] = useState("");
  return (
    <div className="grid min-w-0 gap-3">
      <label className="grid min-w-0 gap-2 text-sm">
        {credentialImportLabels[method]}
        <textarea
          ref={text}
          name="credential"
          required
          maxLength={65536}
          rows={method === "oauth_auth_json" ? 5 : 3}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          className="min-w-0 resize-y rounded-lg border border-white/15 bg-slate-950/40 px-3 py-2 font-mono text-xs text-slate-100 focus-visible:outline-2 focus-visible:outline-cyan-300"
        />
      </label>
      {method === "oauth_auth_json" ? (
        <label className="grid gap-2 text-sm">
          Or choose an auth.json file
          <input
            type="file"
            name="credentialFile"
            accept=".json,application/json"
            className="min-w-0 text-xs"
            onChange={(event) => {
              const input = event.currentTarget;
              const file = input.files?.[0];
              const current = ++generation.current;
              setError("");
              if (text.current) text.current.value = "";
              if (!file) {
                loading(false);
                return;
              }
              if (file.size > 65536) {
                input.value = "";
                loading(false);
                setError("Choose a file of 64 KiB or smaller.");
                return;
              }
              loading(true);
              void file
                .text()
                .then((value) => {
                  // Closing, changing ownership/provider/method or replacing the file invalidates this read.
                  if (
                    current !== generation.current ||
                    input.files?.[0] !== file ||
                    !text.current?.isConnected
                  )
                    return;
                  if (!validCredentialImportText(value)) {
                    input.value = "";
                    setError(
                      "The import must contain valid text of 64 KiB or smaller.",
                    );
                  } else text.current.value = value;
                })
                .catch(() => {
                  if (
                    current === generation.current &&
                    input.files?.[0] === file &&
                    text.current?.isConnected
                  )
                    setError(
                      "The file could not be read. Choose it again or paste its contents.",
                    );
                })
                .finally(() => {
                  if (
                    current === generation.current &&
                    text.current?.isConnected
                  )
                    loading(false);
                });
            }}
          />
        </label>
      ) : null}
      <p className="text-xs text-slate-400">
        {method === "oauth_auth_json"
          ? "Import the OAuth auth.json from Codex. API-key files and agent identity files are not supported."
          : "Paste the refresh token for this Codex account."}{" "}
        Maximum 64 KiB.
      </p>
      {error ? (
        <p role="alert" className="text-sm text-amber-200">
          {error}
        </p>
      ) : null}
    </div>
  );
}
