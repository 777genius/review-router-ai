"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@reviewrouter/ui";
export function StatisticsRetry() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() => startTransition(() => router.refresh())}
    >
      {pending ? "Retrying…" : "Retry statistics"}
    </Button>
  );
}
