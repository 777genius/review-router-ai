import { ShieldCheck } from "lucide-react";
import { Badge } from "@reviewrouter/ui";

export function HostedSessionEncryptionBadge({
  size = "md",
  label = "Encrypted",
}: {
  readonly size?: "md" | "xs";
  readonly label?: string;
}): React.ReactElement {
  return (
    <Badge
      tone="success"
      size={size}
      className="inline-flex items-center gap-1.5"
    >
      <ShieldCheck
        aria-hidden="true"
        className={size === "xs" ? "h-3 w-3" : "h-3.5 w-3.5"}
      />
      {label}
    </Badge>
  );
}
