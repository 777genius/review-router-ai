/** Optional private operator ingress must never reuse the native service credential. */
export function validateMemoryOperatorCredentials(input: {
  readonly operatorToken: string | undefined;
  readonly nativeServiceKey: string | undefined;
}): void {
  const token = input.operatorToken;
  if (!token) return;
  if (
    token.length < 32 ||
    token.length > 8_192 ||
    token === input.nativeServiceKey
  )
    throw new Error("memory_operator_configuration_invalid");
}
