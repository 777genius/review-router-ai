"use client";

import { Check } from "lucide-react";
import { RadioCard, RadioCardGroup } from "@reviewrouter/ui";
import type { ProviderIdentity } from "../../../src/features/provider-setup/provider-identity";
import type { SetupProviderId } from "../../../src/features/provider-setup/setup-provider";
import { ProviderLogo } from "../provider-logo";

type ProviderOption = Readonly<{
  value: SetupProviderId;
  label: string;
  identity: ProviderIdentity;
  disabled: boolean;
  description?: string;
}>;

export function ProviderCards({
  value,
  options,
  disabled,
  onValueChange,
}: Readonly<{
  value: SetupProviderId | null;
  options: readonly ProviderOption[];
  disabled: boolean;
  onValueChange: (value: SetupProviderId) => void;
}>): React.ReactElement {
  return (
    <section className="grid gap-3">
      <h3 className="text-sm font-semibold text-cyan-50">Provider</h3>
      <RadioCardGroup
        label="Provider"
        value={value}
        disabled={disabled}
        className="grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
        onValueChange={(next) => onValueChange(next as SetupProviderId)}
      >
        {options.map((option) => (
          <RadioCard
            key={option.value}
            value={option.value}
            title={option.label}
            icon={<ProviderLogo providerId={option.identity} />}
            disabled={option.disabled}
            disabledReason={option.description}
            meta={
              value === option.value ? (
                <Check
                  aria-label="Selected"
                  className="h-5 w-5 text-emerald-300"
                />
              ) : null
            }
            className="h-full has-[[data-checked]]:border-emerald-400 has-[[data-checked]]:bg-emerald-400/[0.07] [&>[role=radio]]:sr-only"
          />
        ))}
      </RadioCardGroup>
    </section>
  );
}
