"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

const links = [
  { href: "/support", label: "Support" },
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
  { href: "/refund-policy", label: "Refund policy" },
  { href: "/disconnect", label: "Disconnect" },
] as const;

export function DashboardAwareFooter({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (pathname !== "/dashboard" && !pathname?.startsWith("/dashboard/"))
    return children;

  return (
    <footer
      aria-label="Dashboard footer"
      className="border-t border-cyan-200/10 bg-[var(--rr-footer-bg)]"
    >
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3 text-xs text-slate-400 sm:px-6">
        <div className="flex items-center gap-3">
          <a
            href="/"
            className="inline-flex min-h-11 items-center text-sm font-semibold text-cyan-100"
          >
            ReviewRouter
          </a>
          <span>© 2026</span>
        </div>
        <nav
          aria-label="Dashboard footer links"
          className="flex flex-wrap items-center gap-x-4"
        >
          {links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="inline-flex min-h-11 items-center rounded-sm text-slate-300 hover:text-cyan-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300"
            >
              {link.label}
            </a>
          ))}
        </nav>
      </div>
    </footer>
  );
}
