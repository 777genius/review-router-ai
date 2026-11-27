// Generated from provider-usage/domain/native-usage-context.ts. Do not edit.
/** Request-scoped native evidence. A provider or account label never supplies it. */
export type UsageBilling =
  | Readonly<{
      status: "known";
      kind: "subscription" | "credits" | "free" | "payg" | "mixed";
    }>
  | Readonly<{ status: "unknown" }>;

export type NativeUsageContext = Readonly<{
  schemaVersion: 1;
  providerId: string;
  productId: string;
  profileId: string;
  modelId: string;
  billing: UsageBilling;
}>;

export function validNativeUsageContext(value: NativeUsageContext): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (
    Object.keys(value).length !== 6 ||
    value.schemaVersion !== 1 ||
    ![value.providerId, value.productId, value.profileId].every(
      (id) =>
        typeof id === "string" &&
        /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(id),
    ) ||
    typeof value.modelId !== "string" ||
    !value.modelId.length ||
    value.modelId.length > 256 ||
    [...value.modelId].some(
      (character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    ) ||
    !value.billing ||
    typeof value.billing !== "object" ||
    Array.isArray(value.billing)
  )
    return false;
  return value.billing.status === "unknown"
    ? Object.keys(value.billing).length === 1
    : value.billing.status === "known" &&
        Object.keys(value.billing).length === 2 &&
        ["subscription", "credits", "free", "payg", "mixed"].includes(
          value.billing.kind,
        );
}

/** Unknown members stay unknown; a mixed aggregate never becomes a subscription. */
export function combineUsageBilling(
  values: readonly UsageBilling[],
): UsageBilling {
  if (!values.length || values.some((value) => value.status !== "known"))
    return { status: "unknown" };
  const kinds = new Set(
    values.flatMap((value) => (value.status === "known" ? [value.kind] : [])),
  );
  return { status: "known", kind: kinds.size === 1 ? [...kinds][0]! : "mixed" };
}
