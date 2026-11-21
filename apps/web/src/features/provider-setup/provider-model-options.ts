import {
  getProviderCatalogEntry,
  type ReviewModelOption,
} from "@reviewrouter/features-review-providers";
import {
  getSetupProvider,
  type SetupProviderId,
  type SetupProvider,
} from "./setup-provider";
import type { AccountProfileView } from "../../server/account-gateway-accounts";
import type { AccountModelCatalogView } from "../account-gateway/connection-capabilities";
import {
  accountModelCatalogFresh,
  accountModelCatalogRequired,
} from "./account-model-catalog-freshness";

/**
 * A model choice. `awaitsAccountList` marks a choice blocked only because the
 * account's own list is not current yet; the list status explains that once,
 * so the choice carries no reason of its own.
 */
export type AccountModelOption = ReviewModelOption & {
  readonly awaitsAccountList?: true;
};

/** Public metadata describes choices; the exact account still owns admission. */
export function gatewayProviderModelOptions(
  options: readonly ReviewModelOption[],
  profile:
    | (Pick<AccountProfileView, "models" | "connection"> &
        Pick<AccountProfileView, "id" | "protocol"> &
        Partial<Pick<AccountProfileView, "authKind">>)
    | undefined,
  capability?: Readonly<{
    catalog?: AccountModelCatalogView | undefined;
    requiresTools: boolean;
  }>,
): readonly AccountModelOption[] {
  const supported = new Set(profile?.models ?? []);
  const catalog = capability?.catalog;
  const freshNative = accountModelCatalogFresh(profile, catalog);
  const required = accountModelCatalogRequired(profile);
  const combined = [
    ...options,
    ...(profile?.models ?? [])
      .filter((value) => !options.some((option) => option.value === value))
      .map(
        (value): ReviewModelOption => ({
          value,
          label: value,
          provider:
            profile?.connection?.provider === "nvidia" ? "nvidia" : "codex",
        }),
      ),
  ].map((option): AccountModelOption => {
    // A required list that is missing or out of date blocks every choice until
    // it is read again (see AccountModelOption).
    if (required && !freshNative) {
      const blocked = {
        ...option,
        disabled: true,
        awaitsAccountList: true as const,
      };
      delete blocked.description;
      return blocked;
    }
    if (!supported.has(option.value))
      return {
        ...option,
        disabled: true,
        description: [option.description, "Unavailable for this account."]
          .filter(Boolean)
          .join(" "),
      };
    const native =
      freshNative && catalog.models.includes(option.value)
        ? profile?.connection?.modelSettings.find(
            (setting) => setting.modelId === option.value,
          )
        : undefined;
    if (!native) {
      // Trial model membership must come from this exact NVIDIA account,
      // not a public model name or a stale/cross-vendor snapshot.
      return required
        ? {
            ...option,
            disabled: true,
            description: [
              option.description,
              "This account's model list does not include it.",
            ]
              .filter(Boolean)
              .join(" "),
          }
        : option;
    }
    const refused =
      capability?.requiresTools !== false &&
      !native.tools.allowed.some(
        (choice) => choice === "function" || choice === "function_and_custom",
      );
    const display = { ...option, disabled: refused };
    const metadata =
      option.metadataDescription ??
      (option.disabled ? undefined : option.description);
    const description = [
      metadata,
      refused
        ? "Tool calling is not supported by this account model."
        : undefined,
    ]
      .filter(Boolean)
      .join(" ");
    if (description) display.description = description;
    else delete display.description;
    if (refused) display.badge = "Unsupported";
    else if (display.badge === "Unsupported") delete display.badge;
    return display;
  });
  // Keep the public ranking inside each group while putting usable choices first.
  return [
    ...combined.filter((option) => !option.disabled),
    ...combined.filter((option) => option.disabled),
  ];
}

/**
 * The model a new provider starts with: the provider's catalogue default when
 * this account offers it, otherwise its only usable model, otherwise none.
 * The user still sees it and confirms the provider before anything is saved.
 */
export function suggestedModel(
  options: readonly ReviewModelOption[],
  provider: SetupProviderId | null,
  native: readonly SetupProvider[] = [],
): string {
  const usable = options.filter((option) => !option.disabled);
  const catalog = provider
    ? getSetupProvider(provider, native).publicCatalogProvider
    : null;
  const preferred = catalog
    ? getProviderCatalogEntry(catalog).defaultModel
    : null;
  if (preferred && usable.some((option) => option.value === preferred))
    return preferred;
  return usable.length === 1 ? usable[0]!.value : "";
}
