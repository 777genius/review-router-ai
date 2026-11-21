import { z } from "zod";
import { secretSubmission } from "@agent-teams/account-gateway/http";
import type { CredentialImportMethod } from "../features/account-gateway/connection-capabilities";
import type {
  AccountOAuthCompletion,
  AccountProfileView,
} from "./account-gateway-accounts";
import { operationCompletion } from "./account-connection-catalog";

// Explicit v1/v2 compatibility only. V3 sends bounded opaque inputs to native.
const uuid = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
export function snapshotAccountCredential(
  method: CredentialImportMethod | undefined,
  value: string,
) {
  return secretSubmission.credential.parse(
    method
      ? { kind: "credential_import", method, value }
      : { kind: "api_key", value },
  );
}
// The SDK owns the closed credential grammars. Snapshot before any await;
// no URL/code/state is retained in an intent or safe view.
const oauthCredentialCompletionSchema = z.union([
  z.strictObject({
    nonce: uuid,
    callbackURL: z
      .string()
      .refine(
        (value) =>
          secretSubmission.oauthCallbackURL.safeParse(value).success ||
          secretSubmission.grokOAuthCallbackURL.safeParse(value).success,
      ),
  }),
  z.strictObject({
    nonce: uuid,
    authorizationCode: z
      .string()
      .refine(
        (value) =>
          secretSubmission.claudeOAuthAuthorizationCode.safeParse(value)
            .success ||
          secretSubmission.grokOAuthAuthorizationCode.safeParse(value).success,
      ),
  }),
]);
const oauthCompletionSchema = z.union([
  oauthCredentialCompletionSchema,
  z.strictObject({
    nonce: uuid,
    authorizationResult: z.string().min(1).max(8257),
  }),
]);
type NormalizedOAuthCompletion = z.infer<
  typeof oauthCredentialCompletionSchema
>;
export function oauthCompletionCredential(intent: NormalizedOAuthCompletion) {
  return "authorizationCode" in intent
    ? { authorizationCode: intent.authorizationCode }
    : { callbackURL: intent.callbackURL };
}
/** Credential authority comes from the saved profile, never from the pasted value. */
export function oauthCompletionMatchesProfile(
  profile: Pick<AccountProfileView, "id" | "label" | "connection">,
  completion: NormalizedOAuthCompletion | { nonce: string },
): boolean {
  const { inputKind: kind, providerId } = operationCompletion(profile);
  if (kind === "none") return false;
  if (providerId === "grok") {
    return "authorizationCode" in completion
      ? secretSubmission.grokOAuthAuthorizationCode.safeParse(
          completion.authorizationCode,
        ).success
      : "callbackURL" in completion &&
          secretSubmission.grokOAuthCallbackURL.safeParse(
            completion.callbackURL,
          ).success;
  }
  return kind === "authorization_code"
    ? "authorizationCode" in completion &&
        secretSubmission.claudeOAuthAuthorizationCode.safeParse(
          completion.authorizationCode,
        ).success
    : "callbackURL" in completion &&
        secretSubmission.oauthCallbackURL.safeParse(completion.callbackURL)
          .success;
}
export function snapshotOAuthCompletion(
  raw: AccountOAuthCompletion,
): NormalizedOAuthCompletion {
  const captured = oauthCompletionSchema.parse(raw);
  if (!("authorizationResult" in captured)) return captured;
  // Legacy pending operation DTOs omit profile metadata. Decode only the closed
  // SDK credential representation; the Gateway still selects the saved profile.
  const { nonce, authorizationResult } = captured;
  const callback =
    secretSubmission.oauthCallbackURL.safeParse(authorizationResult).success ||
    secretSubmission.grokOAuthCallbackURL.safeParse(authorizationResult)
      .success;
  return oauthCredentialCompletionSchema.parse(
    callback
      ? { nonce, callbackURL: authorizationResult }
      : { nonce, authorizationCode: authorizationResult },
  );
}
