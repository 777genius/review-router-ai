import type {
  ReviewFinding,
  ReviewFindingSeverity,
} from "./review-publication";

const maxPublicationBodyBytes = 60_000;
const maxFindingBodyChars = 2_500;

export type ReviewSummaryLocale =
  | "en"
  | "ru"
  | "uk"
  | "es"
  | "pt"
  | "fr"
  | "de"
  | "it"
  | "zh"
  | "ja"
  | "ko";

type SeverityCounts = {
  readonly total: number;
  readonly critical: number;
  readonly major: number;
  readonly minor: number;
  readonly info: number;
};

type ReviewSummaryCopy = {
  readonly noFindingsHeading: string;
  readonly findingsHeading: (counts: SeverityCounts) => string;
  readonly location: string;
  readonly moreFindings: (count: number) => string;
};

export function resolveReviewSummaryLocale(
  language: string | undefined,
): ReviewSummaryLocale {
  const normalized = language?.trim().toLowerCase() ?? "";
  if (
    !normalized ||
    normalized === "en" ||
    normalized.startsWith("en-") ||
    normalized === "english"
  ) {
    return "en";
  }
  if (
    normalized.startsWith("ru") ||
    normalized.includes("рус") ||
    normalized === "russian"
  ) {
    return "ru";
  }
  if (
    normalized.startsWith("uk") ||
    normalized.includes("укр") ||
    normalized === "ukrainian"
  ) {
    return "uk";
  }
  if (
    normalized.startsWith("es") ||
    normalized === "spanish" ||
    normalized.includes("español")
  ) {
    return "es";
  }
  if (
    normalized.startsWith("pt") ||
    normalized === "portuguese" ||
    normalized.includes("portugu")
  ) {
    return "pt";
  }
  if (
    normalized.startsWith("fr") ||
    normalized === "french" ||
    normalized.includes("français")
  ) {
    return "fr";
  }
  if (
    normalized.startsWith("de") ||
    normalized === "german" ||
    normalized.includes("deutsch")
  ) {
    return "de";
  }
  if (
    normalized.startsWith("it") ||
    normalized === "italian" ||
    normalized.includes("italiano")
  ) {
    return "it";
  }
  if (
    normalized.startsWith("zh") ||
    normalized === "chinese" ||
    normalized.includes("中文") ||
    normalized.includes("汉语") ||
    normalized.includes("漢語")
  ) {
    return "zh";
  }
  if (
    normalized.startsWith("ja") ||
    normalized === "japanese" ||
    normalized.includes("日本")
  ) {
    return "ja";
  }
  if (
    normalized.startsWith("ko") ||
    normalized === "korean" ||
    normalized.includes("한국") ||
    normalized.includes("조선")
  ) {
    return "ko";
  }
  return "en";
}

export function renderFindingsSummaryMarkdown(input: {
  readonly language?: string | undefined;
  readonly findings: readonly ReviewFinding[];
  readonly maxBytes?: number | undefined;
}): string {
  const maxBytes = input.maxBytes ?? maxPublicationBodyBytes;
  const copy = copies[resolveReviewSummaryLocale(input.language)];
  const counts = countFindingsBySeverity(input.findings);
  const heading =
    counts.total === 0 ? copy.noFindingsHeading : copy.findingsHeading(counts);
  const lines: string[] = [heading];
  const sorted = [...input.findings].sort(compareFindings);

  const remaining: string[] = [];
  for (const finding of sorted) {
    const block = renderFindingDetails(copy, finding);
    const candidate = [...lines, "", block];
    if (utf8Bytes(candidate.join("\n")) > maxBytes) {
      remaining.push(compactFindingLine(finding));
      continue;
    }
    lines.push("", block);
  }

  if (remaining.length > 0) {
    const header = ["", copy.moreFindings(remaining.length)];
    if (utf8Bytes([...lines, ...header].join("\n")) <= maxBytes) {
      lines.push(...header);
      for (const compact of remaining) {
        const candidate = [...lines, compact];
        if (utf8Bytes(candidate.join("\n")) > maxBytes) {
          break;
        }
        lines.push(compact);
      }
    }
  }

  return limitUtf8(lines.join("\n"), maxBytes);
}

function renderFindingDetails(
  copy: ReviewSummaryCopy,
  finding: ReviewFinding,
): string {
  const location = formatFindingLocation(finding);
  const summary = escapeHtml(
    [finding.severity, location, finding.title.trim()]
      .filter(Boolean)
      .join(" · "),
  );
  const parts = [
    "<details>",
    `<summary>${summary}</summary>`,
    "",
    truncateChars(
      neutralizeDetailsMarkup(finding.body.trim()),
      maxFindingBodyChars,
    ),
  ];
  if (location) {
    parts.push(
      "",
      `**${copy.location}:** \`${escapeMarkdownInline(location)}\``,
    );
  }
  parts.push("", "</details>");
  return parts.join("\n");
}

function compactFindingLine(finding: ReviewFinding): string {
  const location = formatFindingLocation(finding);
  return `- **${finding.severity}**${location ? ` \`${escapeMarkdownInline(location)}\`` : ""} ${escapeMarkdownInline(finding.title.trim())}`;
}

function compareFindings(left: ReviewFinding, right: ReviewFinding): number {
  const rank: Record<ReviewFindingSeverity, number> = {
    critical: 4,
    major: 3,
    minor: 2,
    info: 1,
  };
  return (
    rank[right.severity] - rank[left.severity] ||
    left.title.localeCompare(right.title)
  );
}

function countFindingsBySeverity(
  findings: readonly ReviewFinding[],
): SeverityCounts {
  return findings.reduce(
    (counts, finding) => ({
      ...counts,
      total: counts.total + 1,
      [finding.severity]: counts[finding.severity] + 1,
    }),
    { total: 0, critical: 0, major: 0, minor: 0, info: 0 },
  );
}

function formatFindingLocation(finding: ReviewFinding): string {
  if (!finding.location) {
    return "";
  }
  const line = finding.location.newLine ?? finding.location.oldLine;
  return line
    ? `${finding.location.filePath}:${line}`
    : finding.location.filePath;
}

function formatSeverityCounts(counts: SeverityCounts): string {
  return (
    (
      [
        ["critical", counts.critical],
        ["major", counts.major],
        ["minor", counts.minor],
        ["info", counts.info],
      ] as const
    )
      .filter(([, count]) => count > 0)
      .map(([label, count]) => `${count} ${label}`)
      .join(", ") || "0"
  );
}

function slavicFindingWord(
  count: number,
  forms: [string, string, string],
): string {
  const mod100 = count % 100;
  const mod10 = count % 10;
  if (mod100 >= 11 && mod100 <= 14) {
    return forms[2];
  }
  if (mod10 === 1) {
    return forms[0];
  }
  if (mod10 >= 2 && mod10 <= 4) {
    return forms[1];
  }
  return forms[2];
}

const copies: Record<ReviewSummaryLocale, ReviewSummaryCopy> = {
  en: {
    noFindingsHeading: "## No findings",
    findingsHeading: (counts) =>
      `## ${counts.total} ${counts.total === 1 ? "finding" : "findings"} (${formatSeverityCounts(counts)})`,
    location: "Location",
    moreFindings: (count) =>
      `**${count} more ${count === 1 ? "finding" : "findings"} omitted from this summary because of size limits.**`,
  },
  ru: {
    noFindingsHeading: "## Замечаний нет",
    findingsHeading: (counts) =>
      `## ${counts.total} ${slavicFindingWord(counts.total, ["замечание", "замечания", "замечаний"])} (${formatSeverityCounts(counts)})`,
    location: "Место",
    moreFindings: (count) =>
      `**Ещё ${count} ${slavicFindingWord(count, ["замечание", "замечания", "замечаний"])} не влезли в это сообщение из‑за лимита размера.**`,
  },
  uk: {
    noFindingsHeading: "## Зауважень немає",
    findingsHeading: (counts) =>
      `## ${counts.total} ${slavicFindingWord(counts.total, ["зауваження", "зауваження", "зауважень"])} (${formatSeverityCounts(counts)})`,
    location: "Місце",
    moreFindings: (count) =>
      `**Ще ${count} ${slavicFindingWord(count, ["зауваження", "зауваження", "зауважень"])} не вмістилися в це повідомлення через ліміт розміру.**`,
  },
  es: {
    noFindingsHeading: "## Sin hallazgos",
    findingsHeading: (counts) =>
      `## ${counts.total} ${counts.total === 1 ? "hallazgo" : "hallazgos"} (${formatSeverityCounts(counts)})`,
    location: "Ubicación",
    moreFindings: (count) =>
      `**${count} ${count === 1 ? "hallazgo más omitido" : "hallazgos más omitidos"} de este resumen por el límite de tamaño.**`,
  },
  pt: {
    noFindingsHeading: "## Nenhum achado",
    findingsHeading: (counts) =>
      `## ${counts.total} ${counts.total === 1 ? "achado" : "achados"} (${formatSeverityCounts(counts)})`,
    location: "Local",
    moreFindings: (count) =>
      `**Mais ${count} ${count === 1 ? "achado omitido" : "achados omitidos"} deste resumo por limite de tamanho.**`,
  },
  fr: {
    noFindingsHeading: "## Aucune anomalie",
    findingsHeading: (counts) =>
      `## ${counts.total} ${counts.total === 1 ? "anomalie" : "anomalies"} (${formatSeverityCounts(counts)})`,
    location: "Emplacement",
    moreFindings: (count) =>
      `**${count} ${count === 1 ? "anomalie supplémentaire omise" : "anomalies supplémentaires omises"} de ce résumé à cause de la limite de taille.**`,
  },
  de: {
    noFindingsHeading: "## Keine Befunde",
    findingsHeading: (counts) =>
      `## ${counts.total} ${counts.total === 1 ? "Befund" : "Befunde"} (${formatSeverityCounts(counts)})`,
    location: "Stelle",
    moreFindings: (count) =>
      `**${count} weitere ${count === 1 ? "Befund" : "Befunde"} fehlen in dieser Zusammenfassung wegen des Größenlimits.**`,
  },
  it: {
    noFindingsHeading: "## Nessun rilievo",
    findingsHeading: (counts) =>
      `## ${counts.total} ${counts.total === 1 ? "rilievo" : "rilievi"} (${formatSeverityCounts(counts)})`,
    location: "Posizione",
    moreFindings: (count) =>
      `**Altri ${count} ${count === 1 ? "rilievo omesso" : "rilievi omessi"} da questo riassunto per il limite di dimensione.**`,
  },
  zh: {
    noFindingsHeading: "## 无问题",
    findingsHeading: (counts) =>
      `## ${counts.total} 个问题（${formatSeverityCounts(counts)}）`,
    location: "位置",
    moreFindings: (count) => `**受篇幅限制，本摘要还省略了 ${count} 条问题。**`,
  },
  ja: {
    noFindingsHeading: "## 指摘なし",
    findingsHeading: (counts) =>
      `## 指摘 ${counts.total} 件（${formatSeverityCounts(counts)}）`,
    location: "場所",
    moreFindings: (count) =>
      `**サイズ制限のため、この要約から指摘がさらに ${count} 件省略されています。**`,
  },
  ko: {
    noFindingsHeading: "## 이슈 없음",
    findingsHeading: (counts) =>
      `## 이슈 ${counts.total}개 (${formatSeverityCounts(counts)})`,
    location: "위치",
    moreFindings: (count) =>
      `**크기 제한 때문에 이 요약에서 이슈 ${count}개가 더 생략되었습니다.**`,
  },
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeMarkdownInline(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("`", "\\`");
}

function neutralizeDetailsMarkup(value: string): string {
  return value.replace(/<\/?(?:details|summary)\b[^>]*>/gi, (tag) =>
    tag.replaceAll("<", "&lt;").replaceAll(">", "&gt;"),
  );
}

function dropIncompleteDetails(value: string): string {
  const openTags = Array.from(value.matchAll(/<details\b[^>]*>/gi));
  const closeTags = Array.from(value.matchAll(/<\/details>/gi));
  if (openTags.length <= closeTags.length) {
    return value;
  }
  const lastOpen = openTags[openTags.length - 1];
  if (lastOpen?.index === undefined) {
    return value;
  }
  return value.slice(0, lastOpen.index).trimEnd();
}

function truncateChars(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars - 12).trimEnd()}\n\n[truncated]`;
}

function utf8Bytes(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function limitUtf8(value: string, maxBytes: number): string {
  if (utf8Bytes(value) <= maxBytes) {
    return value;
  }
  const suffix = "\n\n[truncated]";
  const budget = Math.max(0, maxBytes - utf8Bytes(suffix));
  let cut = Buffer.from(value, "utf8").subarray(0, budget).toString("utf8");
  if (cut.endsWith("\uFFFD")) {
    cut = cut.slice(0, -1);
  }
  return `${dropIncompleteDetails(cut).trimEnd()}${suffix}`;
}
