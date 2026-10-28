import type { ReviewModelOption } from "@reviewrouter/features-review-providers";
import type { AccountProfileView } from "../../server/account-gateway-accounts";

/** Public metadata describes choices; the exact account still owns admission. */
export function gatewayProviderModelOptions(
  options: readonly ReviewModelOption[],
  profile: Pick<AccountProfileView, "models"> | undefined,
): readonly ReviewModelOption[] {
  const supported = new Set(profile?.models ?? []);
  const combined = [
    ...options.map((option) =>
      supported.has(option.value)
        ? option
        : {
            ...option,
            disabled: true,
            description: [option.description, "Unavailable for this account."]
              .filter(Boolean)
              .join(" "),
          },
    ),
    ...(profile?.models ?? [])
      .filter((value) => !options.some((option) => option.value === value))
      .map(
        (value): ReviewModelOption => ({
          value,
          label: value,
          provider: "codex",
        }),
      ),
  ];
  // Keep the public ranking inside each group while putting usable choices first.
  return [
    ...combined.filter((option) => !option.disabled),
    ...combined.filter((option) => option.disabled),
  ];
}
