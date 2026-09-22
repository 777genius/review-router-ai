"use client";

import { usePathname, useSearchParams } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type PendingNavigationTarget = {
  readonly pathname: string;
  readonly search: string;
};

type NavigationPhase = "idle" | "loading" | "complete";

type NavigationFeedbackValue = {
  readonly isPending: boolean;
  readonly target: PendingNavigationTarget | null;
};

const idleNavigationFeedback: NavigationFeedbackValue = {
  isPending: false,
  target: null,
};

const NavigationFeedbackContext = createContext<NavigationFeedbackValue>(
  idleNavigationFeedback,
);

const fallbackTimeoutMs = 15_000;
const completionDurationMs = 220;

export function useNavigationFeedback(): NavigationFeedbackValue {
  return useContext(NavigationFeedbackContext);
}

export function NavigationFeedbackProvider({
  children,
}: {
  readonly children: ReactNode;
}): React.ReactElement {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const routeKey = navigationKey(pathname, searchParams.toString());
  const previousRouteKey = useRef(routeKey);
  const fallbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const completionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [phase, setPhase] = useState<NavigationPhase>("idle");
  const [target, setTarget] = useState<PendingNavigationTarget | null>(null);

  const clearTimers = useCallback(() => {
    if (fallbackTimer.current) clearTimeout(fallbackTimer.current);
    if (completionTimer.current) clearTimeout(completionTimer.current);
    fallbackTimer.current = null;
    completionTimer.current = null;
  }, []);

  const beginNavigation = useCallback(
    (url: URL) => {
      if (navigationKey(url.pathname, url.search) === routeKey) {
        clearTimers();
        setPhase("idle");
        setTarget(null);
        return;
      }

      clearTimers();
      setTarget({ pathname: url.pathname, search: url.search });
      setPhase("loading");
      fallbackTimer.current = setTimeout(() => {
        setPhase("idle");
        setTarget(null);
      }, fallbackTimeoutMs);
    },
    [clearTimers, routeKey],
  );

  useEffect(() => {
    if (previousRouteKey.current === routeKey) return;
    previousRouteKey.current = routeKey;
    clearTimers();
    setPhase((current) => (current === "idle" ? current : "complete"));
    completionTimer.current = setTimeout(() => {
      setPhase("idle");
      setTarget(null);
    }, completionDurationMs);
  }, [clearTimers, routeKey]);

  useEffect(() => {
    const handleClick = (event: MouseEvent): void => {
      if (
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const element =
        event.target instanceof Element
          ? event.target.closest("a[href]")
          : null;
      if (!(element instanceof HTMLAnchorElement)) return;
      const rawHref = element.getAttribute("href");
      if (
        !rawHref ||
        rawHref.startsWith("#") ||
        element.target === "_blank" ||
        element.hasAttribute("download") ||
        element.dataset.navigationFeedback === "ignore" ||
        element.getAttribute("aria-disabled") === "true"
      )
        return;

      const url = new URL(rawHref, window.location.href);
      if (url.origin !== window.location.origin) return;
      beginNavigation(url);
    };
    const handlePopState = (): void =>
      beginNavigation(new URL(window.location.href));

    document.addEventListener("click", handleClick);
    window.addEventListener("popstate", handlePopState);
    return () => {
      document.removeEventListener("click", handleClick);
      window.removeEventListener("popstate", handlePopState);
      clearTimers();
    };
  }, [beginNavigation, clearTimers]);

  const value = useMemo<NavigationFeedbackValue>(
    () => ({ isPending: phase === "loading", target }),
    [phase, target],
  );

  return (
    <NavigationFeedbackContext.Provider value={value}>
      {phase === "idle" ? null : (
        <div
          className="rr-navigation-progress"
          data-state={phase}
          role="progressbar"
          aria-label="Loading page"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={phase === "complete" ? 100 : 35}
        >
          <span />
        </div>
      )}
      {children}
    </NavigationFeedbackContext.Provider>
  );
}

function navigationKey(pathname: string, search: string): string {
  const normalizedSearch = search.startsWith("?") ? search.slice(1) : search;
  return normalizedSearch ? `${pathname}?${normalizedSearch}` : pathname;
}
