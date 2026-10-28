"use client";

import { ChevronDown } from "lucide-react";
import { useId, useState } from "react";

const faqItems = [
  {
    question: "Does ReviewRouter see my source code?",
    answer:
      "No. Reviews run inside your GitHub Actions, so the AI reads the diff on your runners. Our dashboard gets the review result and run status — never your files.",
  },
  {
    question: "What does the GitHub App read then?",
    answer:
      "Pull request titles, states, check results, and workflow settings. It does not open your source tree or download repository contents.",
  },
  {
    question: "Which AI can I use?",
    answer:
      "Your own Codex or Claude subscription, or an API key for MiMo, OpenRouter, or another compatible provider. Credentials can live in GitHub Actions secrets or in our encrypted account pool — you choose, and you can remove them whenever you want.",
  },
  {
    question: "Is it really free?",
    answer:
      "Yes, within clear fair-use limits. There is no seat pricing and no credit card. When you stop using ReviewRouter, delete the workflow and reviews stop with it.",
  },
  {
    question: "Can I run everything myself?",
    answer:
      "Yes. ReviewRouter is open source and the dashboard can run on your own server. Reviews already run in your CI either way, so your code never moves.",
  },
  {
    question: "Where do I get help?",
    answer:
      "The support page is the fastest route during beta. The security page lists exactly what ReviewRouter can and cannot see.",
  },
] as const;

export function HomeFaq(): React.ReactElement {
  const [openIndex, setOpenIndex] = useState<number | null>(0);
  const baseId = useId();

  return (
    <section
      aria-labelledby="home-faq-title"
      className="mx-auto w-[calc(100%-2rem)] max-w-4xl sm:w-[calc(100%-3rem)]"
    >
      <div className="rr-reveal text-center">
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
        {faqItems.map((item, index) => {
          const open = openIndex === index;
          const triggerId = `${baseId}-faq-trigger-${index}`;
          const panelId = `${baseId}-faq-panel-${index}`;

          return (
            <div
              key={item.question}
              className={`home-faq-item rr-reveal rounded-2xl border bg-[var(--rr-surface-panel)] transition-colors duration-300 ${
                open
                  ? "border-cyan-200/30"
                  : "border-cyan-200/14 hover:border-cyan-200/26"
              }`}
            >
              <button
                id={triggerId}
                type="button"
                aria-controls={panelId}
                aria-expanded={open}
                onClick={() => setOpenIndex(open ? null : index)}
                className="group flex w-full cursor-pointer items-center justify-between gap-4 rounded-2xl px-5 py-4 text-left text-base font-semibold text-cyan-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
              >
                <span className="flex min-w-0 items-center gap-3">
                  <span
                    aria-hidden="true"
                    className={`font-mono text-[0.66rem] font-semibold tracking-[0.16em] transition-colors duration-300 ${
                      open ? "text-lime-300" : "text-slate-500"
                    }`}
                  >
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  {item.question}
                </span>
                <span
                  aria-hidden="true"
                  className={`grid size-8 shrink-0 place-items-center rounded-full border transition duration-300 ${
                    open
                      ? "rotate-180 border-lime-300/40 bg-lime-300/[0.08] text-lime-200"
                      : "border-cyan-200/15 text-cyan-200 group-hover:border-cyan-200/35"
                  }`}
                >
                  <ChevronDown className="size-4" />
                </span>
              </button>

              <div
                id={panelId}
                aria-hidden={!open}
                className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none ${
                  open
                    ? "grid-rows-[1fr] opacity-100"
                    : "grid-rows-[0fr] opacity-0"
                }`}
              >
                <div className="overflow-hidden">
                  <p className="px-5 pb-5 pl-[3.25rem] text-sm leading-6 text-slate-400">
                    {item.answer}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
