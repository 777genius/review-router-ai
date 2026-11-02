"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@reviewrouter/ui";
export function HistoryRetry() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() => start(() => router.refresh())}
    >
      {pending ? "Loading…" : "Try loading again"}
    </Button>
  );
}
