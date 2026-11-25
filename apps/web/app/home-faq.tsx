"use client";

import { ChevronDown } from "lucide-react";
import { useId, useState } from "react";

const faqItems = [
  {
    question: "Can I use my own AI subscription?",
    answer:
      "Yes. Connect a supported Codex or Claude subscription, or use a compatible provider API key.",
  },
  {
    question: "Is the platform really free?",
    answer:
      "The control plane is free to start under fair-use limits. Your AI provider or subscription and CI runners can have separate costs.",
  },
  {
    question: "Where does my code go?",
    answer:
      "Review execution runs in your GitHub Actions by default. The selected AI provider receives the review context your workflow sends; ReviewRouter's control plane does not download your repository source by default.",
  },
  {
    question: "Can I self-host?",
    answer:
      "Yes. ReviewRouter has a guided self-hosted deployment. You retain control of your infrastructure and settings.",
  },
] as const;

export function HomeFaq(): React.ReactElement {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
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
          Short answers, clear control
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
