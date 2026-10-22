import { createHash } from "node:crypto";

// The v2 URL is immutable. Changing its visual contract requires a new version.
const severities = ["critical", "major", "minor", "info"] as const;
const updateKeys = ["new", "resolved", "open", "unverified"] as const;
const allowed = new Set([
  "state",
  "variant",
  "theme",
  "layout",
  "reviewed",
  "total",
  ...severities,
  ...updateKeys,
]);
type Severity = (typeof severities)[number];
type UpdateCounts = Readonly<Record<(typeof updateKeys)[number], number>>;
export type ReviewBannerInput = {
  readonly state: "complete" | "incomplete";
  readonly theme: "light" | "dark";
  readonly layout: "wide" | "compact";
  readonly counts: Readonly<Record<Severity, number>>;
  readonly coverage?: { readonly reviewed: number; readonly total: number };
} & (
  | { readonly variant: "first"; readonly update?: never }
  | { readonly variant: "update"; readonly update: UpdateCounts }
);

function count(value: string | null): number | null {
  return value !== null && /^(?:0|[1-9][0-9]{0,3})$/.test(value)
    ? Number(value)
    : null;
}

function parseBannerInput(url: URL): ReviewBannerInput | null {
  const params = url.searchParams;
  if (
    [...params.keys()].some(
      (key) => !allowed.has(key) || params.getAll(key).length !== 1,
    )
  )
    return null;
  const state = params.get("state");
  const variant = params.get("variant");
  const theme = params.get("theme") ?? "dark";
  const layout = params.get("layout") ?? "wide";
  if (
    (state !== "complete" && state !== "incomplete") ||
    (variant !== "first" && variant !== "update") ||
    (theme !== "light" && theme !== "dark") ||
    (layout !== "wide" && layout !== "compact")
  )
    return null;
  const severityValues = severities.map((key) => count(params.get(key) ?? "0"));
  if (severityValues.some((value) => value === null)) return null;
  let coverage: ReviewBannerInput["coverage"];
  if (params.has("reviewed") || params.has("total")) {
    const reviewed = count(params.get("reviewed"));
    const total = count(params.get("total"));
    if (reviewed === null || total === null || reviewed > total) return null;
    coverage = { reviewed, total };
  }
  const common = {
    state,
    theme,
    layout,
    counts: Object.fromEntries(
      severities.map((key, index) => [key, severityValues[index]!]),
    ) as Record<Severity, number>,
    ...(coverage ? { coverage } : {}),
  } as const;
  if (variant === "first") {
    return updateKeys.some((key) => params.has(key))
      ? null
      : { ...common, variant };
  }
  const updates = updateKeys.map((key) => count(params.get(key)));
  if (updates.some((value) => value === null)) return null;
  const update = Object.fromEntries(
    updateKeys.map((key, index) => [key, updates[index]!]),
  ) as UpdateCounts;
  if (update.new > update.open || update.unverified > update.open) return null;
  return { ...common, variant, update };
}

const escapeXml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
const issue = (n: number) => (n === 1 ? "issue" : "issues");

type Headline = {
  readonly first: string;
  readonly second?: string;
  readonly note: string;
};
function headline(input: ReviewBannerInput): Headline {
  const total = severities.reduce((sum, key) => sum + input.counts[key], 0);
  if (input.state === "incomplete") {
    return input.variant === "update"
      ? {
          first: "Review update is incomplete",
          second: `${input.update.open} ${issue(input.update.open)} ${input.update.open === 1 ? "remains" : "remain"} open`,
          note: "Unverified issues remain open until confirmed.",
        }
      : {
          first:
            total > 0
              ? `${total} preliminary ${issue(total)}`
              : "Review could not finish",
          second: "Results remain preliminary.",
          note: "This result is not an all-clear.",
        };
  }
  if (input.variant === "update") {
    const { resolved, open, unverified } = input.update;
    return {
      first:
        resolved > 0
          ? `${resolved} ${issue(resolved)} resolved.`
          : open > 0
            ? `${open} ${issue(open)} ${open === 1 ? "remains" : "remain"} open.`
            : "No open issues",
      ...(resolved > 0
        ? {
            second:
              open > 0
                ? unverified > 0
                  ? `${open} still open; ${unverified} unverified.`
                  : `${open} still ${open === 1 ? "needs" : "need"} a fix.`
                : "No open issues.",
          }
        : unverified > 0
          ? {
              second: `${unverified} ${unverified === 1 ? "needs" : "need"} verification.`,
            }
          : {}),
      note: "What changed since the previous review",
    };
  }
  const severity = severities.find((key) => input.counts[key] > 0);
  if (!severity) return { first: "No issues found", note: "Review complete." };
  const amount = input.counts[severity];
  const label = severity === "info" ? "informational" : severity;
  return {
    first: `${amount} ${label} ${issue(amount)}`,
    second: `${amount === 1 ? "needs" : "need"} attention`,
    note: "Review the findings below.",
  };
}

function renderBanner(input: ReviewBannerInput): string {
  const compact = input.layout === "compact";
  const width = compact ? 480 : 1200;
  const height = compact ? 360 : 280;
  const dark = input.theme === "dark";
  const action = input.variant === "first";
  const clean =
    input.state === "complete" &&
    severities.every((key) => input.counts[key] === 0) &&
    (input.variant === "first" || input.update.open === 0);
  const accent =
    input.state === "incomplete"
      ? dark
        ? "#e3b341"
        : "#7d4e00"
      : clean
        ? dark
          ? "#7ee787"
          : "#1a7f37"
        : action
          ? dark
            ? "#ff8f96"
            : "#ad2333"
          : dark
            ? "#79c0ff"
            : "#0969da";
  const ink = dark ? "#f0f3f6" : "#1f2328";
  const muted = dark ? "#a6b0bc" : "#59636e";
  const background = dark ? "#151b23" : "#f6f8fa";
  const tint =
    input.state === "incomplete"
      ? dark
        ? "#292317"
        : "#fff8e6"
      : clean
        ? dark
          ? "#14261c"
          : "#edf8f0"
        : action
          ? dark
            ? "#27191f"
            : "#fff2f1"
          : dark
            ? "#182437"
            : "#edf3ff";
  const line = dark ? "#30363d" : "#d1d9e0";
  const status =
    input.state === "incomplete"
      ? "REVIEW INCOMPLETE"
      : input.variant === "update"
        ? "REVIEW UPDATED"
        : "REVIEW COMPLETE";
  const text = (
    x: number,
    y: number,
    value: string,
    size: number,
    color = ink,
    extra = "",
  ) =>
    `<text x="${x}" y="${y}" font-size="${size}" fill="${color}"${extra}>${escapeXml(value)}</text>`;
  const title = headline(input);
  const coverage = input.coverage
    ? input.state === "incomplete"
      ? `Coverage checked: ${input.coverage.reviewed} / ${input.coverage.total} files`
      : `${input.coverage.reviewed} / ${input.coverage.total} files reviewed`
    : "";
  const metrics =
    input.variant === "update"
      ? updateKeys
          .filter((key) => key !== "unverified" || input.update.unverified > 0)
          .map((key) => `${input.update[key]} ${key}`)
      : severities
          .filter((key) => input.counts[key] > 0)
          .map((key) => `${input.counts[key]} ${key}`);
  const left = compact ? 28 : 36;
  const headlineFirst =
    compact && input.state === "incomplete" && input.variant === "update"
      ? "Update not finished"
      : action && input.state === "complete" && title.second && !compact
        ? `${title.first} ${title.second}`
        : title.first;
  const headlineSecond =
    compact &&
    input.variant === "update" &&
    input.update.resolved > 0 &&
    input.update.open > 0 &&
    input.update.unverified > 0
      ? `${input.update.open} open; ${input.update.unverified} unverified.`
      : action && input.state === "complete" && !compact
        ? undefined
        : title.second;
  const note =
    compact && input.variant === "update" && input.state === "incomplete"
      ? "Open issues await confirmation."
      : title.note;
  const svgTitle = [status, headlineFirst, headlineSecond, coverage, ...metrics]
    .filter(Boolean)
    .join(" · ");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title"><title id="title">${escapeXml(svgTitle)}</title><defs><linearGradient id="background"><stop stop-color="${tint}"/><stop offset="1" stop-color="${background}"/></linearGradient></defs><rect width="${width}" height="${height}" rx="8" fill="url(#background)"/>${action ? `<path d="M2 8V${height - 8}" stroke="${accent}" stroke-width="4"/>` : ""}<g font-family="Arial,Helvetica,sans-serif">${text(left, compact ? 38 : 43, status, 22, muted, ' font-weight="600" letter-spacing="2"')}${coverage ? text(compact ? left : width - left, compact ? 73 : 43, coverage, compact ? 22 : 20, muted, compact ? "" : ' text-anchor="end"') : ""}${text(left, compact ? 126 : 112, headlineFirst, compact ? 32 : 40, ink, ' font-weight="600" letter-spacing="-0.6"')}${headlineSecond ? text(left, compact ? 168 : 159, headlineSecond, compact ? 28 : 40, ink, ' font-weight="600" letter-spacing="-0.6"') : ""}${text(left, compact ? 211 : 195, note, 22, muted)}${metrics.length > 0 ? `<path d="M${left} ${compact ? 236 : 216}H${width - left}" stroke="${line}"/>` : ""}${metrics.map((metric, index) => text(left + (compact ? (index % 2) * ((width - left * 2) / 2) : index * 282), compact ? 277 + Math.floor(index / 2) * 48 : 255, metric, compact ? 26 : 25, input.variant === "update" && index === 1 ? (dark ? "#7ee787" : "#1a7f37") : accent, ' font-weight="600"')).join("")}</g></svg>`;
}

export function reviewBannerResponse(request: Request): Response {
  const invalid = () =>
    new Response("Invalid banner parameters", {
      status: 400,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "text/plain; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      },
    });
  if (request.url.length > 2_048) return invalid();
  const input = parseBannerInput(new URL(request.url));
  if (!input) return invalid();
  const svg = renderBanner(input);
  const etag = `"${createHash("sha256").update(svg).digest("hex")}"`;
  const headers = {
    "Content-Type": "image/svg+xml; charset=utf-8",
    "Cache-Control": "public, max-age=31536000, immutable",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "X-Content-Type-Options": "nosniff",
    ETag: etag,
  };
  const cached = matchesValidator(request.headers.get("If-None-Match"), etag);
  return new Response(cached ? null : svg, {
    status: cached ? 304 : 200,
    headers,
  });
}

function matchesValidator(header: string | null, etag: string): boolean {
  if (header === null) return false;
  if (header.trim() === "*") return true;
  const values: string[] = [];
  let quoted = false;
  let start = 0;
  for (let index = 0; index < header.length; index += 1) {
    if (header[index] === '"') quoted = !quoted;
    if (header[index] === "," && !quoted) {
      values.push(header.slice(start, index));
      start = index + 1;
    }
  }
  if (quoted) return false;
  values.push(header.slice(start));
  return values.some((value) => value.trim().replace(/^W\//, "") === etag);
}
