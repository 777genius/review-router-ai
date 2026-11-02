import type { ReviewModelOption } from "@reviewrouter/features-review-providers";
import type { AccountProfileView } from "../../server/account-gateway-accounts";
import type { AccountModelCatalogView } from "../account-gateway/connection-capabilities";

/** Public metadata describes choices; the exact account still owns admission. */
export function gatewayProviderModelOptions(
  options: readonly ReviewModelOption[],
  profile: Pick<AccountProfileView, "models" | "connection"> | undefined,
  capability?: Readonly<{
    catalog?: AccountModelCatalogView | undefined;
    requiresTools: boolean;
  }>,
): readonly ReviewModelOption[] {
  const supported = new Set(profile?.models ?? []);
  const catalog = capability?.catalog;
  const nativeSource =
    profile?.connection?.provider === "openrouter"
      ? "openrouter"
      : profile?.connection?.provider === "openai"
        ? "codex"
        : undefined;
  const now = Date.now();
  const freshNative =
    catalog?.status === "snapshot" &&
    catalog.source === nativeSource &&
    Date.parse(catalog.fetchedAt ?? "") <= now &&
    Date.parse(catalog.expiresAt ?? "") > now;
  const combined = [
    ...options,
    ...(profile?.models ?? [])
      .filter((value) => !options.some((option) => option.value === value))
      .map(
        (value): ReviewModelOption => ({
          value,
          label: value,
          provider: "codex",
        }),
      ),
  ].map((option): ReviewModelOption => {
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
    if (!native) return option;
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
