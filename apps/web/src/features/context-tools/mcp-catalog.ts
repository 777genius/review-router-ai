/** Serializable public catalog contract. Keep Node and registry parsing out of clients. */
export type McpCatalogConnection = {
  id: string;
  url: string;
  headers: Record<string, string>;
  credentials: Record<string, { source: "dashboard-secret" }>;
};

export type McpCatalogPreset = {
  id: string;
  name: string;
  description: string;
  distributionId: string;
  releaseSequence: number;
  packageVersion: string;
  sourceUrl: string;
  catalogUrl: string;
  targetClient: "opencode";
  registryAuthentication: string;
  compatibility:
    | {
        status: "supported";
        authentication: "none" | "api-key";
        connection: McpCatalogConnection;
      }
    | { status: "unsupported"; reason: string };
};
