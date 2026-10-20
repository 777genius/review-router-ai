import {
  Ban,
  CheckCircle2,
  HelpCircle,
  Loader2,
  PowerOff,
  TriangleAlert,
  XCircle,
} from "lucide-react";
import type { AccountStatusKind } from "./accounts-copy";

const statusIcons = {
  ready: CheckCircle2,
  confirming: Loader2,
  removing: Loader2,
  disabled: PowerOff,
  retired: Ban,
  attention: TriangleAlert,
  unknown: HelpCircle,
  unavailable: XCircle,
} as const;

const statusTones = {
  ready: "text-emerald-300",
  confirming: "text-cyan-200",
  removing: "text-cyan-200",
  disabled: "text-slate-400",
  retired: "text-slate-400",
  attention: "text-amber-300",
  unknown: "text-slate-400",
  unavailable: "text-slate-400",
} as const;

export function AccountStatusIcon({
  kind,
}: {
  readonly kind: AccountStatusKind;
}): React.ReactElement {
  const Icon = statusIcons[kind];
  return (
    <Icon
      aria-hidden="true"
      className={[
        "size-4 shrink-0",
        statusTones[kind],
        kind === "confirming" || kind === "removing" ? "animate-spin" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    />
  );
}

export function AccountStatusLine({
  kind,
  text,
}: {
  readonly kind: AccountStatusKind;
  readonly text: string;
}): React.ReactElement {
  return (
    <span className="inline-flex items-center gap-1.5">
      <AccountStatusIcon kind={kind} />
      <span>{text}</span>
    </span>
  );
}
