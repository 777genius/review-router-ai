"use client";

import type { ProviderAuthMode } from "@reviewrouter/features-review-providers";
import {
  providerIdentityForAuthMode,
  type ProviderIdentity,
} from "../../src/features/provider-setup/provider-identity";
import { ProviderLogo } from "./provider-logo";

type ProviderAuthLogoProps = {
  readonly authMode: ProviderAuthMode;
  readonly providerId?: ProviderIdentity | undefined;
};

/** Compatibility wrapper: Gateway needs an explicit upstream display identity. */
export function ProviderAuthLogoFrame({
  authMode,
  providerId,
}: ProviderAuthLogoProps): React.ReactElement {
  return (
    <ProviderLogo
      providerId={providerId ?? providerIdentityForAuthMode(authMode)}
    />
  );
}
