import { legacyReviewBannerSvg } from "./legacy-banner";
import { reviewBannerLogo } from "./logo";
import { reviewBannerSvgResponse } from "./response";

const severities = ["critical", "major", "minor", "info"] as const;
const updateKeys = ["new", "resolved", "open", "unverified"] as const;
const verificationKeys = [
  "verified",
  "not_verified",
  "confirmed_open",
] as const;
const allowed = new Set([
  "state",
  "variant",
  "theme",
  "layout",
  "reviewed",
  "total",
  ...severities,
  ...updateKeys,
  ...verificationKeys,
]);
type Severity = (typeof severities)[number];
type UpdateCounts = Readonly<Record<(typeof updateKeys)[number], number>>;
export type ReviewBannerInput = {
  readonly state: "complete" | "incomplete";
  readonly theme: "light" | "dark" | "auto";
  readonly layout: "wide" | "compact";
  readonly counts: Readonly<Record<Severity, number>>;
  readonly coverage?: { readonly reviewed: number; readonly total: number };
  readonly verification?: {
    readonly fixesVerified: number;
    readonly unverified: number;
    readonly confirmedOpen: number;
  };
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
    (theme !== "light" && theme !== "dark" && theme !== "auto") ||
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
  let verification: ReviewBannerInput["verification"];
  if (verificationKeys.some((key) => params.has(key))) {
    const [fixesVerified, unverified, confirmedOpen] = verificationKeys.map(
      (key) => count(params.get(key)),
    );
    if (fixesVerified == null || unverified == null || confirmedOpen == null)
      return null;
    verification = { fixesVerified, unverified, confirmedOpen };
  }
  const common = {
    state,
    theme,
    layout,
    counts: Object.fromEntries(
      severities.map((key, index) => [key, severityValues[index]!]),
    ) as Record<Severity, number>,
    ...(coverage ? { coverage } : {}),
    ...(verification ? { verification } : {}),
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
  if (input.verification) return verificationHeadline(input);
  const total = severities.reduce((sum, key) => sum + input.counts[key], 0);
  if (input.state === "incomplete") {
    return input.variant === "update"
      ? {
          first: "Review update is incomplete",
          second:
            input.update.unverified > 0
              ? `${input.update.unverified} previous ${issue(input.update.unverified)} not verified`
              : "No reliable conclusion yet",
          note: "Review incomplete. Do not treat this as a pass.",
        }
      : {
          first:
            total > 0
              ? `${total} preliminary ${issue(total)}`
              : "Review could not finish",
          second: "Results remain preliminary.",
          note: "Do not treat this result as a pass.",
        };
  }
  if (input.variant === "update") {
    const { new: added, resolved, open, unverified } = input.update;
    // The installed URL contract includes uncertain prior issues in `open`.
    // Keep that contract, but never describe them as confirmed current issues.
    const confirmedOpen = Math.max(0, open - unverified);
    return {
      first:
        added > 0
          ? `${added} new ${issue(added)} found`
          : resolved > 0
            ? `${resolved} ${issue(resolved)} resolved`
            : confirmedOpen > 0 || unverified > 0
              ? "No new issues found"
              : "No open issues",
      ...(added > 0 && resolved > 0
        ? { second: `${resolved} ${issue(resolved)} resolved` }
        : confirmedOpen > added
          ? {
              second: `${confirmedOpen - added} confirmed ${issue(confirmedOpen - added)} still open`,
            }
          : resolved > 0 && confirmedOpen === 0 && unverified === 0
            ? {
                second: "No open issues",
              }
            : {}),
      note:
        unverified > 0
          ? `${unverified} previous ${issue(unverified)} not verified`
          : "Compared with the previous completed review",
    };
  }
  const severity = severities.find((key) => input.counts[key] > 0);
  if (!severity) return { first: "No issues found", note: "Review complete." };
  if (severity === "info")
    return {
      first: `${input.counts.info} informational ${input.counts.info === 1 ? "note" : "notes"}`,
      note: "No critical, major or minor issues found.",
    };
  const amount = input.counts[severity];
  const label = severity;
  return {
    first: `${amount} ${label} ${issue(amount)}`,
    second: `${amount === 1 ? "needs" : "need"} attention`,
    note:
      total > amount
        ? `${total} findings in total · see the details below.`
        : "Review the findings below.",
  };
}

/** Verification is a review-time fact; its candidate count never means native closure. */
function verificationHeadline(input: ReviewBannerInput): Headline {
  const { verification, ...previous } = input;
  const original = headline(previous as ReviewBannerInput);
  if (!verification) return original;
  const { fixesVerified, unverified, confirmedOpen } = verification;
  const fixes = `${fixesVerified} ${fixesVerified === 1 ? "fix" : "fixes"} verified`;
  const unknown = `${unverified} previous ${issue(unverified)} not verified`;
  const confirmed = `${confirmedOpen} previous ${issue(confirmedOpen)} confirmed open`;
  if (input.state === "incomplete")
    return {
      first:
        input.variant === "update" && input.update.new > 0
          ? `${input.update.new} new ${issue(input.update.new)} found`
          : original.first,
      ...(fixesVerified > 0
        ? { second: fixes }
        : unverified > 0
          ? { second: unknown }
          : original.second
            ? { second: original.second }
            : {}),
      note:
        unverified > 0
          ? `${unknown}.`
          : fixesVerified > 0
            ? "Review remains incomplete."
            : original.note,
    };
  const added = input.variant === "update" ? input.update.new : 0;
  const resolved = input.variant === "update" ? input.update.resolved : 0;
  const total = severities.reduce((sum, key) => sum + input.counts[key], 0);
  const current = input.variant === "first" && total > 0;
  const first =
    added > 0
      ? `${added} new ${issue(added)} found`
      : current
        ? original.first
        : fixesVerified > 0
          ? fixes
          : resolved > 0
            ? `${resolved} ${issue(resolved)} resolved`
            : confirmedOpen > 0
              ? confirmed
              : unverified > 0
                ? unknown
                : original.first;
  const second =
    (added > 0 || current) && fixesVerified > 0
      ? fixes
      : fixesVerified > 0 && resolved > 0
        ? `${resolved} ${issue(resolved)} resolved`
        : fixesVerified > 0 && confirmedOpen > 0
          ? confirmed
          : unverified > 0 && first !== unknown
            ? unknown
            : current
              ? original.second
              : undefined;
  return {
    first,
    ...(second ? { second } : {}),
    note:
      unverified > 0
        ? first === unknown
          ? "No all-clear established."
          : `${unknown}.`
        : fixesVerified > 0
          ? "Thread closure counted separately."
          : confirmedOpen > 0
            ? "Previously reported findings remain confirmed."
            : original.note,
  };
}

function renderBanner(input: ReviewBannerInput): string {
  const compact = input.layout === "compact";
  const width = compact ? 480 : 1200;
  const height = compact ? 360 : 280;
  const dark = input.theme === "dark";
  const auto = input.theme === "auto";
  const themeValues = new Map<string, { light: string; dark: string }>();
  const themeValue = (name: string, darkValue: string, lightValue: string) => {
    if (!auto) return dark ? darkValue : lightValue;
    themeValues.set(name, { light: lightValue, dark: darkValue });
    return `var(--${name},${lightValue})`;
  };
  const action = input.variant === "first";
  const clean =
    input.state === "complete" &&
    severities.every((key) => input.counts[key] === 0) &&
    (input.variant === "first" || input.update.open === 0) &&
    (!input.verification ||
      Object.values(input.verification).every((count) => count === 0));
  const priority = severities.find((key) => input.counts[key] > 0);
  const verificationWarning =
    (input.verification?.unverified ?? 0) > 0 && priority !== "critical";
  const verificationCritical = !!input.verification && priority === "critical";
  const lowPriority =
    action &&
    input.state === "complete" &&
    !clean &&
    priority !== "critical" &&
    !input.verification?.unverified;
  const accent = lowPriority
    ? priority === "major"
      ? themeValue("accent", "#e3b341", "#7d4e00")
      : themeValue("accent", "#79c0ff", "#0969da")
    : input.state === "incomplete" || verificationWarning
      ? themeValue("accent", "#e3b341", "#7d4e00")
      : clean
        ? themeValue("accent", "#7ee787", "#1a7f37")
        : action || verificationCritical
          ? themeValue("accent", "#ff8f96", "#ad2333")
          : themeValue("accent", "#79c0ff", "#0969da");
  const ink = themeValue("ink", "#f0f3f6", "#1f2328");
  const muted = themeValue("muted", "#a6b0bc", "#59636e");
  const background = themeValue("background", "#151b23", "#f6f8fa");
  const tint = lowPriority
    ? priority === "major"
      ? themeValue("tint", "#292317", "#fff8e6")
      : themeValue("tint", "#182437", "#edf3ff")
    : input.state === "incomplete" || verificationWarning
      ? themeValue("tint", "#292317", "#fff8e6")
      : clean
        ? themeValue("tint", "#14261c", "#edf8f0")
        : action || verificationCritical
          ? themeValue("tint", "#27191f", "#fff2f1")
          : themeValue("tint", "#182437", "#edf3ff");
  const line = themeValue("line", "#30363d", "#d1d9e0");
  const verificationUnknownOnly =
    !!input.verification &&
    input.verification.unverified > 0 &&
    input.verification.fixesVerified === 0 &&
    input.verification.confirmedOpen === 0 &&
    severities.every((key) => input.counts[key] === 0) &&
    (input.variant === "first" ||
      (input.update.new === 0 && input.update.resolved === 0));
  const status = verificationUnknownOnly
    ? "VERIFICATION INCOMPLETE"
    : input.state === "incomplete"
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
    `<text x="${x}" y="${y}" font-size="${Math.min(size, Math.floor((width - 56) / Math.max(1, value.length * 0.58)))}" fill="${color}"${extra}>${escapeXml(value)}</text>`;
  const rawTitle = headline(input);
  const title = {
    ...rawTitle,
    first: rawTitle.first.replace(/\.$/u, ""),
    ...(rawTitle.second ? { second: rawTitle.second.replace(/\.$/u, "") } : {}),
  };
  const coverage = input.coverage
    ? input.state === "incomplete"
      ? `Coverage checked: ${input.coverage.reviewed} / ${input.coverage.total} files`
      : `${input.coverage.reviewed} / ${input.coverage.total} files reviewed`
    : "";
  const metrics =
    input.state === "incomplete" &&
    input.variant === "update" &&
    input.update.open === 0 &&
    input.update.new === 0 &&
    input.update.resolved === 0
      ? []
      : input.variant === "update"
        ? updateKeys
            .filter(
              (key) =>
                key !== "unverified" ||
                (input.state === "incomplete" && input.update.unverified > 0),
            )
            .map((key) =>
              key === "open"
                ? `${Math.max(0, input.update.open - input.update.unverified)} confirmed open`
                : `${input.update[key]} ${key === "unverified" ? "not verified" : key}`,
            )
        : severities
            .filter((key) => input.counts[key] > 0)
            .map((key) => `${input.counts[key]} ${key}`);
  const left = compact ? 28 : 36;
  const headlineFirst =
    compact &&
    input.state === "incomplete" &&
    input.variant === "update" &&
    !input.verification
      ? "Update not finished"
      : action &&
          input.state === "complete" &&
          title.second &&
          !compact &&
          !input.verification
        ? `${title.first} ${title.second}`
        : title.first;
  const headlineSecond =
    action && input.state === "complete" && !compact && !input.verification
      ? undefined
      : title.second;
  const note = title.note;
  const logoEffect = compact
    ? ""
    : `<defs><radialGradient id="logoHalo"><stop stop-color="${accent}" stop-opacity="${themeValue("halo-opacity", ".14", ".09")}"/><stop offset="1" stop-color="${accent}" stop-opacity="0"/></radialGradient><filter id="logoGlow" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="13"/></filter><g id="brandLogo">${reviewBannerLogo}</g></defs><g aria-hidden="true"><ellipse cx="1050" cy="134" rx="148" ry="110" fill="url(#logoHalo)"/><g opacity="${themeValue("glow-opacity", ".20", ".13")}" filter="url(#logoGlow)"><use href="#brandLogo" transform="translate(976 63) scale(.287109375)"/></g><use href="#brandLogo" transform="translate(976 63) scale(.287109375)" opacity="${themeValue("logo-opacity", ".30", ".22")}"/></g>`;
  const svgTitle = [
    status,
    headlineFirst,
    headlineSecond,
    coverage,
    ...((input.variant === "update" && input.update.unverified > 0) ||
    (input.verification &&
      (input.verification.unverified > 0 ||
        input.verification.fixesVerified > 0))
      ? [note]
      : []),
    ...metrics,
  ]
    .filter(Boolean)
    .join(" · ");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title"><title id="title">${escapeXml(svgTitle)}</title><defs><linearGradient id="background"><stop stop-color="${tint}"/><stop offset="1" stop-color="${background}"/></linearGradient></defs><rect width="${width}" height="${height}" rx="8" fill="url(#background)"/>${action ? `<path d="M2 8V${height - 8}" stroke="${accent}" stroke-width="4"/>` : ""}${logoEffect}<g font-family="Arial,Helvetica,sans-serif">${text(left, compact ? 38 : 43, status, 22, muted, ' font-weight="600" letter-spacing="2"')}${coverage ? text(compact ? left : width - left, compact ? 73 : 43, coverage, compact ? 22 : 20, muted, compact ? "" : ' text-anchor="end"') : ""}${text(left, compact ? 126 : 112, headlineFirst, compact ? 32 : 40, ink, ' font-weight="600" letter-spacing="-0.6"')}${headlineSecond ? text(left, compact ? 168 : 159, headlineSecond, compact ? 28 : 40, ink, ' font-weight="600" letter-spacing="-0.6"') : ""}${text(left, compact ? 211 : 195, note, 22, muted)}${metrics.length > 0 ? `<path d="M${left} ${compact ? 236 : 216}H${width - left}" stroke="${line}"/>` : ""}${metrics.map((metric, index) => text(left + (compact ? (index % 2) * ((width - left * 2) / 2) : index * 282), compact ? 277 + Math.floor(index / 2) * 48 : 255, metric, Math.min(compact ? 26 : 25, Math.floor((compact ? 200 : 264) / (metric.length * 0.58))), input.variant === "first" ? (metric.endsWith(" critical") ? themeValue("critical", "#ff8f96", "#ad2333") : metric.endsWith(" major") ? themeValue("major", "#e3b341", "#7d4e00") : metric.endsWith(" info") ? muted : themeValue("minor", "#79c0ff", "#0969da")) : metric.endsWith(" resolved") ? (input.update.resolved > 0 ? themeValue("resolved", "#7ee787", "#1a7f37") : muted) : metric.endsWith("not verified") ? themeValue("unverified", "#e3b341", "#7d4e00") : accent, ' font-weight="600"')).join("")}</g></svg>`;
  if (!auto) return svg;
  // Build declarations after metric rows have registered their colors too.
  const declarations = (theme: "light" | "dark") =>
    [...themeValues]
      .map(([name, values]) => `--${name}:${values[theme]}`)
      .join(";");
  return svg.replace(
    "<defs>",
    `<style>:root{${declarations("light")}}@media (prefers-color-scheme: dark){:root{${declarations("dark")}}}</style><defs>`,
  );
}

/** Canonical v1 URL also retains the installed legacy state/lang query. */
export function reviewBannerResponse(request: Request): Response {
  if (request.url.length > 2_048) return reviewBannerSvgResponse(request, null);
  const url = new URL(request.url);
  if (!url.searchParams.has("variant")) {
    return reviewBannerSvgResponse(request, legacyReviewBannerSvg(url));
  }
  return modernReviewBannerResponse(request);
}

/** The previous v2 URL accepts the same modern query without legacy fallback. */
export function modernReviewBannerResponse(request: Request): Response {
  if (request.url.length > 2_048) return reviewBannerSvgResponse(request, null);
  const input = parseBannerInput(new URL(request.url));
  return reviewBannerSvgResponse(request, input ? renderBanner(input) : null);
}
