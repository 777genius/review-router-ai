/** Immutable installer identity carried by an issued setup manifest. */
export type CodexRotatingSeedScriptDescriptor = Readonly<{
  url: string;
  version: string;
  sha256: string;
}>;
