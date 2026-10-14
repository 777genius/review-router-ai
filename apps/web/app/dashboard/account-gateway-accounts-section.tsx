import { loadAccountsBootstrap } from "../../src/server/account-gateway-accounts";
import { AccountGatewayControls } from "./account-gateway-account-controls";

export async function AccountGatewayAccountsSection({
  workspaceId,
}: {
  workspaceId: string;
}) {
  const bootstrap = await loadAccountsBootstrap(workspaceId);
  return (
    <section
      className="space-y-4 border-b border-cyan-200/10 pb-6"
      aria-labelledby="gateway-accounts-title"
    >
      <div>
        <h3
          id="gateway-accounts-title"
          className="text-lg font-semibold text-cyan-50"
        >
          Workspace accounts
        </h3>
        <p className="mt-2 text-sm text-slate-400">
          Connect a MiMo or OpenRouter key, or enroll Codex when OAuth is
          enabled for this workspace. Workspace admins can manage these
          accounts. Credentials are stored encrypted on our server and are not
          returned here or copied into the review CI job or repository secrets.
        </p>
        <p className="mt-2 text-sm text-slate-400">
          The selected provider receives the review context. Code in the
          authorized CI job can use its scoped review access; tool environment
          filtering does not fully isolate that access.
        </p>
        <p className="mt-2 text-sm text-slate-400">
          Codex authorization opens once after a fresh enrollment. Enrollment
          remains pending until the gateway confirms an active account.
        </p>
      </div>
      <AccountGatewayControls
        key={bootstrap.context || workspaceId}
        bootstrap={bootstrap}
      />
    </section>
  );
}
