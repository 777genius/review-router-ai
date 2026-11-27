import type { Metadata } from "next";
import { createPublicPageMetadata } from "../seo";

export const metadata: Metadata = createPublicPageMetadata({
  title: "AI providers and connection methods",
  description:
    "Find the supported ways to connect Claude, Gemini, Codex, Grok, Kimi, GLM and other AI providers to ReviewRouter.",
  path: "/providers",
});

type ProviderRow = {
  readonly name: string;
  readonly methods: readonly string[];
  readonly note?: string;
};

type ProviderGroup = {
  readonly title: string;
  readonly subtitle: string;
  readonly rows: readonly ProviderRow[];
};

// Public summary of methods from the qualified Native connection inventory.
// Actual availability comes from the configured deployment, not this list.
const providerGroups: readonly ProviderGroup[] = [
  {
    title: "Claude and Gemini",
    subtitle: "Anthropic, Google and cloud-hosted versions",
    rows: [
      {
        name: "Claude (Anthropic)",
        methods: [
          "API key",
          "Sign in (OAuth)",
          "Session-assisted sign-in",
          "Setup token (code or cookie)",
        ],
      },
      {
        name: "Claude on Amazon Bedrock",
        methods: ["AWS credentials", "Bedrock API key"],
        note: "Requires a configured AWS region",
      },
      {
        name: "Claude on Google Vertex AI",
        methods: ["Google Cloud service account"],
        note: "Requires a Google Cloud project and region",
      },
      {
        name: "Gemini (Google)",
        methods: [
          "API key",
          "Google One sign-in",
          "Code Assist sign-in",
          "AI Studio sign-in",
        ],
        note: "AI Studio requires a configured OAuth client",
      },
      {
        name: "Gemini on Vertex AI",
        methods: ["Google Cloud service account", "Vertex API key"],
        note: "Project/region or supported express mode",
      },
    ],
  },
  {
    title: "OpenAI, Codex and other subscriptions",
    subtitle: "Sign in with an account or use the matching API/plan key",
    rows: [
      {
        name: "OpenAI API",
        methods: ["OpenAI API key"],
        note: "API billing is separate from a Codex subscription",
      },
      {
        name: "Codex",
        methods: [
          "Browser or device sign-in",
          "Import refresh token",
          "Import mobile refresh token",
          "Import auth.json or session",
          "Agent Identity",
          "Personal access token (PAT)",
        ],
        note: "Imported sessions have different refresh and expiry behavior",
      },
      {
        name: "Grok",
        methods: [
          "API key",
          "Browser sign-in",
          "Import refresh token",
          "Import SSO session",
        ],
      },
      {
        name: "Antigravity",
        methods: ["Browser sign-in", "Import refresh token", "API key"],
        note: "API key requires an operator-approved endpoint",
      },
      {
        name: "Kimi",
        methods: ["Pay-as-you-go API key", "Kimi Code plan key"],
      },
      {
        name: "GLM",
        methods: ["Pay-as-you-go API key", "GLM Coding Plan key"],
      },
      {
        name: "MiniMax",
        methods: ["Pay-as-you-go API key", "MiniMax M Plan key"],
      },
    ],
  },
  {
    title: "Other API-key providers",
    subtitle: "Connect with the key issued for the matching provider or plan",
    rows: [
      {
        name: "DeepSeek",
        methods: ["API key"],
      },
      {
        name: "OpenCode Go / Zen",
        methods: ["Go API key", "Zen API key"],
      },
      {
        name: "Command Code",
        methods: ["API key"],
      },
      {
        name: "Cline",
        methods: ["API key"],
      },
      {
        name: "OpenRouter",
        methods: ["API key"],
      },
      {
        name: "NVIDIA Build",
        methods: ["API key"],
      },
    ],
  },
];

export default function ProvidersPage(): React.ReactElement {
  return (
    <main className="home-shell min-h-screen w-full py-10 md:py-14">
      <div className="mx-auto w-[calc(100%-2rem)] max-w-5xl sm:w-[calc(100%-3rem)]">
        <header className="max-w-3xl">
          <p className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">
            Connect an AI provider
          </p>
          <h1 className="mt-4 text-4xl font-semibold text-cyan-50 sm:text-5xl">
            Which AI providers can I use?
          </h1>
          <p className="mt-5 text-base leading-7 text-slate-300">
            Use an API key, sign in to a supported account, or import existing
            credentials. Each provider has different options. The tables below
            describe the methods built into ReviewRouter&apos;s managed-account
            integration; your deployment may enable fewer choices.
          </p>
          <p className="mt-3 text-sm leading-6 text-slate-400">
            In your dashboard, open <strong>Providers → Add account</strong> to
            see exactly which connection methods are available to you.
          </p>
        </header>

        <div className="mt-10 space-y-10">
          {providerGroups.map((group, groupIndex) => (
            <section
              key={group.title}
              aria-labelledby={`provider-group-${groupIndex}`}
            >
              <div className="mb-4">
                <h2
                  id={`provider-group-${groupIndex}`}
                  className="text-2xl font-semibold text-cyan-50"
                >
                  {group.title}
                </h2>
                <p className="mt-1 text-sm text-slate-400">{group.subtitle}</p>
              </div>
              <div className="overflow-hidden rounded-2xl border border-cyan-200/15 bg-[var(--rr-surface-panel)]">
                <table className="w-full table-fixed text-left text-sm">
                  <caption className="sr-only">
                    {group.title} connection methods
                  </caption>
                  <thead className="border-b border-cyan-200/15 bg-cyan-300/[0.045] text-slate-300">
                    <tr>
                      <th
                        scope="col"
                        className="w-[34%] px-3 py-3 font-semibold sm:w-[30%] sm:px-5"
                      >
                        Provider
                      </th>
                      <th
                        scope="col"
                        className="px-3 py-3 font-semibold sm:px-5"
                      >
                        How to connect
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-cyan-200/10">
                    {group.rows.map((row) => (
                      <tr key={row.name}>
                        <th
                          scope="row"
                          className="break-words px-3 py-4 align-top font-semibold text-cyan-50 sm:px-5"
                        >
                          {row.name}
                        </th>
                        <td className="px-3 py-4 align-top sm:px-5">
                          <ul
                            className="flex flex-wrap gap-2"
                            aria-label={`${row.name} connection options`}
                          >
                            {row.methods.map((method) => (
                              <li
                                key={method}
                                className="max-w-full break-words rounded-md border border-cyan-200/15 bg-cyan-300/[0.055] px-2 py-1 text-slate-200"
                              >
                                {method}
                              </li>
                            ))}
                          </ul>
                          {row.note ? (
                            <p className="mt-2 text-xs leading-5 text-slate-400">
                              {row.note}
                            </p>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>

        <section
          className="mt-10 max-w-3xl space-y-3 text-sm leading-7 text-slate-300"
          aria-labelledby="provider-availability-title"
        >
          <h2
            id="provider-availability-title"
            className="text-2xl font-semibold text-cyan-50"
          >
            A few things to know
          </h2>
          <p>
            <strong>MiMo Token Plan</strong> also connects with a Token Plan API
            key using an existing ReviewRouter setup path.
          </p>
          <p>
            The native integration passed 52 controlled connection-and-review
            scenarios, including streaming, tools, reconnect and credential
            cleanup. This does not guarantee that your live account, quota,
            OAuth approval or paid provider is enabled.
          </p>
          <p>
            Managed Gateway accounts and direct GitHub Actions credentials have
            different setup options. The available methods depend on your
            installation and provider configuration.
          </p>
          <p className="flex flex-wrap gap-x-5 gap-y-2">
            <a
              href="/getting-started"
              className="text-cyan-200 underline underline-offset-4"
            >
              Getting started
            </a>
            <a
              href="https://github.com/777genius/review-router-ai/blob/main/docs/provider-connections.md"
              className="text-cyan-200 underline underline-offset-4"
            >
              More details
            </a>
          </p>
        </section>
      </div>
    </main>
  );
}
