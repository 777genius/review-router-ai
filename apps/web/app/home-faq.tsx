import { ChevronDown } from "lucide-react";

const faqItems = [
  {
    question: "Does ReviewRouter upload my source code?",
    answer:
      "No. Reviews run as a compact reusable workflow inside your GitHub Actions, so the model reads the diff in your runner. The control plane orchestrates the run and records metadata about it — your code stays in your CI.",
  },
  {
    question: "What does the GitHub App actually read?",
    answer:
      "Pull request and workflow metadata: titles, states, check runs, and workflow configuration. It does not read your source tree, and it never receives repository contents.",
  },
  {
    question: "Which models can I use?",
    answer:
      "Bring your own: seed Codex OAuth, Claude Code OAuth, or API keys directly into GitHub Actions secrets with one local command. You can also use the encrypted account pool if you would rather keep credentials managed for you.",
  },
  {
    question: "Is it really free?",
    answer:
      "Yes, within clear fair-use limits. There is no seat pricing and no credit card. When you stop using ReviewRouter, delete the workflow and reviews stop with it.",
  },
  {
    question: "Can I run everything myself?",
    answer:
      "Yes. ReviewRouter is open source and the control plane can run in your own environment. Either way, reviews already execute in your CI, so code and execution stay on your side of the boundary.",
  },
  {
    question: "Where do I get help?",
    answer:
      "Trusted beta support is available through the support page while ReviewRouter is in beta, and the security page explains the full trust boundary in detail.",
  },
] as const;

export function HomeFaq(): React.ReactElement {
  return (
    <section
      aria-labelledby="home-faq-title"
      className="mx-auto w-[calc(100%-2rem)] max-w-4xl sm:w-[calc(100%-3rem)]"
    >
      <div className="text-center">
        <p className="font-mono text-xs font-semibold uppercase tracking-[0.22em] text-cyan-300">
          Answers ///
        </p>
        <h2
          id="home-faq-title"
          className="mt-3 text-3xl font-semibold tracking-tight text-cyan-50 sm:text-4xl"
        >
          Questions, answered
        </h2>
      </div>

      <div className="mt-8 grid gap-3">
        {faqItems.map((item) => (
          <details
            key={item.question}
            className="home-faq-item group rounded-2xl border border-cyan-200/14 bg-[var(--rr-surface-panel)] px-5 transition hover:border-cyan-200/28 open:border-cyan-200/28"
          >
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-left text-base font-semibold text-cyan-50 [&::-webkit-details-marker]:hidden">
              {item.question}
              <ChevronDown
                aria-hidden="true"
                className="size-5 shrink-0 text-cyan-200 transition-transform duration-200 group-open:rotate-180"
              />
            </summary>
            <p className="pb-5 text-sm leading-6 text-slate-400">
              {item.answer}
            </p>
          </details>
        ))}
      </div>
    </section>
  );
}
