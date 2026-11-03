/** Evidence from a workflow probe; presence alone does not establish readiness. */
export type RepositoryWorkflowCheck =
  | {
      readonly status: "present";
      readonly expectedActionRefFound: boolean;
      readonly expectedContentMarkersFound?: boolean;
    }
  | { readonly status: "missing" }
  | { readonly status: "unavailable"; readonly reason: string };
