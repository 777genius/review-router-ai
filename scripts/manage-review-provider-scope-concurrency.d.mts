export type ProviderScopeOperation =
  | "status"
  | "activate"
  | "close"
  | "verifyRollback";

export type ProviderScopeClient = {
  connect(): Promise<unknown>;
  end(): Promise<unknown>;
  query(statement: string): Promise<{ rows: readonly { status: unknown }[] }>;
};

export function runProviderScopeConcurrencyOperation(options: {
  operation: ProviderScopeOperation;
  databaseUrl: string;
  createClient?: () => ProviderScopeClient;
  maxAttempts?: number;
}): Promise<{
  status: unknown;
  reconciledAfterAmbiguousCommit: boolean;
}>;
