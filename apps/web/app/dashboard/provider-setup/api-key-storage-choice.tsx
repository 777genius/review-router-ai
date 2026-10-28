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
}: {
  readonly value: ApiKeyStorage;
  readonly onValueChange: (value: ApiKeyStorage) => void;
  readonly disabled?: boolean;
  readonly reviewRouterUnavailable?: string | undefined;
  readonly githubUnavailable?: string | undefined;
}): React.ReactElement {
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-2 text-sm font-semibold text-cyan-50">
        Key storage
      </legend>
      <RadioCardGroup
        label="Key storage"
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
              description={option.description}
              disabled={Boolean(reason)}
              disabledReason={reason}
            />
          );
        })}
      </RadioCardGroup>
    </fieldset>
  );
}
