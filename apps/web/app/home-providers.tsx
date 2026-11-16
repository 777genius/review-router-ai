import { ProviderMark } from "./dashboard/provider-logo";
import type { ProviderIdentity } from "../src/features/provider-setup/provider-identity";

/** Providers shown on the landing: the ones the product can actually connect. */
const providers: readonly {
  id: ProviderIdentity;
  label: string;
}[] = [
  { id: "openai", label: "Codex" },
  { id: "anthropic", label: "Claude Code" },
  { id: "mimo", label: "MiMo" },
  { id: "openrouter", label: "OpenRouter" },
  { id: "kimi", label: "Kimi Code" },
  { id: "nvidia", label: "NVIDIA Build" },
];

export function HomeProviders(): React.ReactElement {
  return (
    <ul className="rr-home-providers" aria-label="Supported AI providers">
      {providers.map(({ id, label }) => (
        <li key={id}>
          <ProviderMark providerId={id} />
          {label}
        </li>
      ))}
    </ul>
  );
}
