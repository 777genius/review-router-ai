import type { Metadata } from "next";
import { createPublicPageMetadata } from "../seo";

export const metadata: Metadata = createPublicPageMetadata({
  title: "AI providers and connection methods",
  description:
    "Compare ReviewRouter AI provider connection methods, including OAuth, API keys, imports and cloud identity, with honest deployment limits.",
  path: "/providers",
});

// Public, manually reviewed summary of the fixed Native G0 inventory.
// It is NOT a runtime catalog, enrollment allowlist or live-provider receipt.
const providerRows = [
  {
    "provider": "Anthropic / Claude",
    "methods": "API key; browser OAuth; session-key-assisted OAuth; setup token by code or cookie",
    "evidence": "Native E2E",
    "notes": "Subscription flows require the corresponding native capability and authorization."
  },
  {
    "provider": "Claude via AWS Bedrock",
    "methods": "AWS SigV4 keys, including temporary session credentials; Bedrock API key",
    "evidence": "Native E2E",
    "notes": "Configured AWS region and credential policy required."
  },
  {
    "provider": "Claude via Vertex AI",
    "methods": "Google service-account JSON",
    "evidence": "Native E2E",
    "notes": "Configured project, region and permitted target required."
  },
  {
    "provider": "Gemini / Google",
    "methods": "API key; Google One OAuth; Code Assist OAuth; AI Studio custom-client OAuth",
    "evidence": "Native E2E",
    "notes": "AI Studio OAuth requires an operator-configured client."
  },
  {
    "provider": "Gemini via Vertex AI",
    "methods": "Google service-account JSON; Vertex API key (project/region or express mode)",
    "evidence": "Native E2E",
    "notes": "Express support is conditional on the native profile."
  },
  {
    "provider": "OpenAI API",
    "methods": "API key",
    "evidence": "Native E2E",
    "notes": "Direct API billing; not Codex subscription authentication."
  },
  {
    "provider": "OpenAI Codex",
    "methods": "Browser or device OAuth; refresh token; mobile refresh token; auth.json; session import; Agent Identity; PAT",
    "evidence": "Native E2E",
    "notes": "Imported credentials have distinct refresh and expiry guarantees."
  },
  {
    "provider": "Grok",
    "methods": "API key; browser OAuth; refresh-token import; SSO import",
    "evidence": "Native E2E",
    "notes": "Subscription and SSO methods require their native enrollment configuration."
  },
  {
    "provider": "Antigravity",
    "methods": "Browser OAuth; refresh-token import; API key for approved target",
    "evidence": "Native E2E",
    "notes": "Operator must allowlist the target; no arbitrary URLs."
  },
  {
    "provider": "Kimi",
    "methods": "PAYG API key; Kimi Code plan API key",
    "evidence": "Native E2E",
    "notes": "Select the matching product and credential."
  },
  {
    "provider": "GLM",
    "methods": "PAYG API key; Coding Plan API key",
    "evidence": "Native E2E",
    "notes": "Organization/project inputs may apply."
  },
  {
    "provider": "DeepSeek",
    "methods": "API key",
    "evidence": "Native E2E",
    "notes": "Only when the native profile is mounted."
  },
  {
    "provider": "MiniMax",
    "methods": "PAYG API key; M Plan API key",
    "evidence": "Native E2E",
    "notes": "Separate products and credential policies."
  },
  {
    "provider": "OpenCode Go / Zen",
    "methods": "Go API key; Zen API key",
    "evidence": "Native E2E",
    "notes": "Distinct native product profiles."
  },
  {
    "provider": "Command Code",
    "methods": "API key",
    "evidence": "Native E2E",
    "notes": "Only when the native profile is mounted."
  },
  {
    "provider": "Cline",
    "methods": "API key",
    "evidence": "Native E2E",
    "notes": "Only when the native profile is mounted."
  },
  {
    "provider": "OpenRouter",
    "methods": "API key",
    "evidence": "Native E2E",
    "notes": "Available models depend on the account and catalog."
  },
  {
    "provider": "NVIDIA Build",
    "methods": "API key",
    "evidence": "Native E2E",
    "notes": "Available models depend on the account and catalog."
  },
  {
    "provider": "MiMo Token Plan",
    "methods": "Token Plan API key",
    "evidence": "Separate path",
    "notes": "Existing ReviewRouter integration; outside the 53 native scenarios."
  },
  {
    "provider": "TypeSafe SystemOne",
    "methods": "API key declaration only; no qualified generative review",
    "evidence": "Unsupported for review",
    "notes": "Excluded: no required generative review, streaming and tool-continuation contract."
  }
] as const;

export default function ProvidersPage(): React.ReactElement {
  return (
    <main className="home-shell min-h-screen w-full py-10 md:py-14">
      <div className="mx-auto w-[calc(100%-2rem)] max-w-6xl sm:w-[calc(100%-3rem)]">
        <header className="max-w-4xl">
          <p className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">
            AI provider connections
          </p>
          <h1 className="mt-4 text-4xl font-semibold text-cyan-50 sm:text-5xl">
            Providers and connection methods
          </h1>
          <p className="mt-5 text-base leading-7 text-slate-300">
            ReviewRouter supports direct CI credentials for selected reviewer
            workflows and managed native accounts. This table describes
            implemented native methods, <strong>not a guarantee that every
            method is enabled in your deployment</strong>. The Add account
            screen shows what your deployment currently permits.
          </p>
          <p className="mt-3 text-sm leading-6 text-slate-400">
            The fixed Native inventory has 53 method/credential variants.
            52 of 52 required scenarios passed controlled integration E2E;
            TypeSafe SystemOne was excluded as unsupported for generative
            review. This is not live paid-provider or production acceptance.
          </p>
        </header>
        <section className="mt-10" aria-labelledby="provider-methods-title">
          <h2 id="provider-methods-title" className="mb-4 text-2xl font-semibold text-cyan-50">
            Managed native accounts
          </h2>
          <div className="overflow-x-auto rounded-2xl border border-cyan-200/15 bg-[var(--rr-surface-panel)]">
            <table className="w-full min-w-[760px] border-collapse text-left text-sm">
              <caption className="sr-only">
                Managed native provider methods and their limitations
              </caption>
              <thead className="border-b border-cyan-200/15 bg-cyan-300/[0.045] text-slate-200">
                <tr>
                  <th scope="col" className="w-[20%] px-4 py-4 font-semibold">Provider / product</th>
                  <th scope="col" className="w-[38%] px-4 py-4 font-semibold">Connection methods</th>
                  <th scope="col" className="w-[16%] px-4 py-4 font-semibold">Evidence</th>
                  <th scope="col" className="px-4 py-4 font-semibold">Requirements and limits</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-cyan-200/10 text-slate-300">
                {providerRows.map((row) => (
                  <tr key={row.provider}>
                    <th scope="row" className="px-4 py-4 align-top font-semibold text-cyan-50">
                      {row.provider}
                    </th>
                    <td className="px-4 py-4 align-top leading-6">{row.methods}</td>
                    <td className="px-4 py-4 align-top">{row.evidence}</td>
                    <td className="px-4 py-4 align-top leading-6 text-slate-400">{row.notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="mt-10 max-w-4xl space-y-4 text-sm leading-7 text-slate-300" aria-labelledby="provider-availability-title">
          <h2 id="provider-availability-title" className="text-2xl font-semibold text-cyan-50">
            What supported means
          </h2>
          <p>
            Native E2E means controlled, source-pinned integration tests for
            connection, streaming review, tool continuation, reconnect and
            credential erasure. It does not prove that your subscription,
            OAuth approval, model quota or provider billing works live.
          </p>
          <p>
            A managed-native method does not automatically become a direct
            GitHub Actions secret or hosted-pool option. Actual methods vary
            by installation. Production listed ten configured profiles on
            27 November 2026, without completed live-provider acceptance.
          </p>
          <p className="flex flex-wrap gap-x-5 gap-y-2">
            <a href="/getting-started" className="text-cyan-200 underline underline-offset-4">
              Direct CI setup
            </a>
            <a href="https://github.com/777genius/review-router-ai/blob/main/docs/provider-connections.md" className="text-cyan-200 underline underline-offset-4">
              Full connection reference
            </a>
            <a href="https://github.com/777genius/review-router-ai/blob/main/ai-docs/deployments/2026-11-21-native-provider-parity.md" className="text-cyan-200 underline underline-offset-4">
              Deployment evidence
            </a>
          </p>
        </section>
      </div>
    </main>
  );
}
