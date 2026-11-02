"use client";

import { RadioCard, RadioCardGroup } from "@reviewrouter/ui";
import {
  apiKeyStorageOptions,
  type ApiKeyStorage,
} from "../../../src/features/provider-setup/api-key-storage";

export function ApiKeyStorageChoice({
  value,
  onValueChange,
  disabled = false,
  reviewRouterUnavailable,
  githubUnavailable,
  credentialKind = "api_key",
}: {
  readonly value: ApiKeyStorage;
  readonly onValueChange: (value: ApiKeyStorage) => void;
  readonly disabled?: boolean;
  readonly reviewRouterUnavailable?: string | undefined;
  readonly githubUnavailable?: string | undefined;
  readonly credentialKind?:
    | "api_key"
    | "codex_session"
    | "claude_subscription"
    | "subscription";
}): React.ReactElement {
  const label =
    credentialKind === "api_key" ? "Key storage" : "Credential storage";
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-2 text-sm font-semibold text-cyan-50">
        {label}
      </legend>
      <RadioCardGroup
        label={label}
        value={value}
        onValueChange={(next) => onValueChange(next as ApiKeyStorage)}
        disabled={disabled}
        className="sm:grid-cols-2"
      >
        {apiKeyStorageOptions.map((option) => {
          const reason =
            option.value === "reviewrouter"
              ? reviewRouterUnavailable
              : githubUnavailable;
          return (
            <RadioCard
              key={option.value}
              value={option.value}
              title={option.label}
              description={
                credentialKind === "codex_session"
                  ? option.value === "reviewrouter"
                    ? "Sign in to Codex once and reuse the connection across repositories."
                    : "Keep this repository's Codex session (auth.json) in GitHub Secrets with automatic refresh."
                  : credentialKind === "claude_subscription"
                    ? option.value === "reviewrouter"
                      ? "Connect your Claude Code subscription once and reuse it across repositories."
                      : "Add your Claude Code subscription token to each repository on GitHub."
                    : credentialKind === "subscription"
                      ? option.value === "reviewrouter"
                        ? "Connect this subscription once and reuse it across repositories."
                        : "GitHub Secrets storage is not available for this subscription."
                      : option.description
              }
              disabled={Boolean(reason)}
              disabledReason={reason}
            />
          );
        })}
      </RadioCardGroup>
    </fieldset>
  );
}
