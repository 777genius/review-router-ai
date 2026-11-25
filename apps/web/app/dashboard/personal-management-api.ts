import * as personalActions from "./personal-account-actions";

/** Connection management of the signed-in user's own connections. Every
 * action checks its context against the session's personal scope. */
export const personalManagementApi = {
  listGatewayAccounts: personalActions.listPersonalGatewayAccounts,
  mutateGatewayAccount: personalActions.mutatePersonalGatewayAccount,
  submitGatewayApiKey: personalActions.submitPersonalGatewayKey,
  readGatewayOperation: personalActions.readPersonalGatewayOperation,
  beginGatewayOAuth: personalActions.beginPersonalGatewayOAuth,
  pollGatewayOAuth: personalActions.pollPersonalGatewayOAuth,
  completeGatewayOAuth: personalActions.completePersonalGatewayOAuth,
};
