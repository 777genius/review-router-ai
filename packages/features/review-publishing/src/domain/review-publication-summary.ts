import type {
  ReviewFinding,
  ReviewFindingSeverity,
  ReviewPublicationTarget,
} from "./review-publication";

const maxPublicationBodyBytes = 60_000;
export type ReviewSummaryState = "complete" | "incomplete";

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
  readonly noFindingsStatus: string;
  readonly findingsStatus: (counts: SeverityCounts) => string;
  readonly details: string;
  readonly incomplete: string;
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
  readonly target?: ReviewPublicationTarget | undefined;
  readonly sourceBaseUrl?: string | undefined;
  readonly reviewState?: ReviewSummaryState | undefined;
  readonly bannerBaseUrl?: string | undefined;
  readonly maxBytes?: number | undefined;
}): string {
  const maxBytes = input.maxBytes ?? maxPublicationBodyBytes;
  const locale = resolveReviewSummaryLocale(input.language);
  const copy = copies[locale];
  const counts = countFindingsBySeverity(input.findings);
  const heading =
    counts.total === 0 ? copy.noFindingsStatus : copy.findingsStatus(counts);
  const icon =
    counts.critical > 0
      ? "🔴"
      : counts.major > 0
        ? "🟠"
        : counts.total > 0
          ? "🟡"
          : "⚪";
  const lines = [`${icon} **${heading}**`];
  if (input.reviewState === "incomplete") lines.push("", copy.incomplete);
  const banner = renderBanner(input, counts, locale);
  if (banner) lines.push("", banner);
  const sorted = [...input.findings].sort(compareFindings);
  let omitted = 0;
  for (let index = 0; index < sorted.length; index += 1) {
    const finding = sorted[index]!;
    const block = renderFinding(
      finding,
      input,
      copy.details,
      sorted.length <= 3,
    );
    // Reserve the omission notice before accepting any complete finding block.
    const notice = copy.moreFindings(sorted.length);
    if (utf8Bytes([...lines, "", block, "", notice].join("\n")) > maxBytes) {
      omitted = sorted.length - index;
      break;
    }
    lines.push("", block);
  }
  if (omitted > 0) lines.push("", copy.moreFindings(omitted));
  // Production's 60KB budget always accommodates status + notice. Tiny caller
  // budgets must also remain bounded, without cutting a Markdown/HTML block.
  const result = lines.join("\n");
  return utf8Bytes(result) <= maxBytes ? result : "";
}

function renderFinding(
  finding: ReviewFinding,
  input: {
    readonly target?: ReviewPublicationTarget | undefined;
    readonly sourceBaseUrl?: string | undefined;
    readonly language?: string | undefined;
  },
  details: string,
  expanded: boolean,
): string {
  const title = `**[${finding.severity}] ${escapeMarkdownInline(finding.title.trim())}**`;
  const location = renderLocation(finding, input);
  const body = safeBody(finding.body.trimEnd());
  if (!expanded) {
    return [
      "<details>",
      `<summary>${escapeHtml(`[${finding.severity}] ${finding.title.trim()}${formatFindingLocation(finding) ? ` · ${formatFindingLocation(finding)}` : ""}`)}</summary>`,
      "",
      ...(location ? [location, ""] : []),
      body,
      "",
      "</details>",
    ].join("\n");
  }
  const excerpt = firstParagraph(
    finding.body,
    resolveReviewSummaryLocale(input.language),
  );
  return [
    title,
    ...(location ? [location] : []),
    ...(excerpt ? ["", escapeMarkdownInline(excerpt)] : []),
    "",
    "<details>",
    `<summary>${details}</summary>`,
    "",
    body,
    "",
    "</details>",
  ].join("\n");
}

function firstParagraph(body: string, locale: ReviewSummaryLocale): string {
  const first =
    body.replace(/^(?:[ \t]*\r?\n)+/, "").split(/\r?\n\s*\r?\n/, 1)[0] ?? "";
  if (
    /^(?: {4}|\t| {0,3}(?:`{3,}|~{3,}|<|#{1,6}\s|>|[-*+]\s|\d+[.)]\s|\|))/.test(
      first,
    ) ||
    /\n\s*\|?\s*:?-{3,}/.test(first)
  )
    return "";
  const paragraph = first.replace(/\s+/g, " ").trim();
  const chars = Array.from(paragraph);
  if (chars.length <= 320) return paragraph;
  const prefix = chars.slice(0, 319).join("");
  const boundary = prefix.lastIndexOf(" ");
  if (boundary > 0) return `${prefix.slice(0, boundary).trimEnd()}…`;
  // Languages without spaces still have word boundaries; do not hard-cut a
  // word, identifier or URL just because it exceeds the preview budget.
  if (
    !/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(
      prefix,
    )
  )
    return "";
  const urlTokens = Array.from(
    paragraph.matchAll(/\b(?:[a-z][a-z\d+.-]*:|www\.)\S+/giu),
    (match) => ({ start: match.index, end: match.index + match[0].length }),
  );
  let usedChars = 0;
  let wordEnd = 0;
  for (const segment of new Intl.Segmenter(locale, {
    granularity: "word",
  }).segment(paragraph)) {
    usedChars += Array.from(segment.segment).length;
    if (usedChars > 319) break;
    const end = segment.index + segment.segment.length;
    if (
      segment.isWordLike &&
      !urlTokens.some((url) => end > url.start && end < url.end)
    )
      wordEnd = end;
  }
  return wordEnd > 0 ? `${paragraph.slice(0, wordEnd)}…` : "";
}

function safeBody(value: string): string {
  let fence: { readonly char: string; readonly length: number } | undefined;
  const lines = value.split(/\r?\n/).map((line) => {
    const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (match) {
      const delimiter = match[1]!;
      if (!fence) {
        if (delimiter[0] === "`" && match[2]?.includes("`"))
          return escapeHtml(line);
        fence = { char: delimiter[0]!, length: delimiter.length };
      } else if (
        delimiter[0] === fence.char &&
        delimiter.length >= fence.length &&
        !match[2]?.trim()
      )
        fence = undefined;
      return line;
    }
    return fence ? line : escapeHtml(line);
  });
  if (fence) lines.push(fence.char.repeat(fence.length));
  return lines.join("\n");
}

function renderLocation(
  finding: ReviewFinding,
  input: {
    readonly target?: ReviewPublicationTarget | undefined;
    readonly sourceBaseUrl?: string | undefined;
  },
): string {
  const label = formatFindingLocation(finding);
  if (!label) return "";
  const fallback = `\`${escapeHtml(label.replace(/\s+/g, " ")).replaceAll("`", "&#96;")}\``;
  const target = input.target;
  const location = finding.location;
  if (!target || !location || !/^[a-f0-9]{40}$/i.test(target.headSha))
    return fallback;
  const sha =
    location.newLine === undefined && location.oldLine !== undefined
      ? target.baseSha
      : target.headSha;
  if (!sha || !/^[a-f0-9]{40}$/i.test(sha)) return fallback;
  const base = safeHttpsBase(
    input.sourceBaseUrl ??
      (target.provider === "github" ? "https://github.com" : ""),
  );
  const parts = target.repositoryFullName.split("/");
  if (
    !base ||
    parts.some((part) => !part || part === "." || part === "..") ||
    (target.provider === "github" && parts.length !== 2)
  )
    return fallback;
  const pathParts = location.filePath.split("/");
  if (pathParts.some((part) => !part || part === "." || part === ".."))
    return fallback;
  const path = pathParts.map(encodeURIComponent).join("/");
  const repo = parts.map(encodeURIComponent).join("/");
  const line = location.newLine ?? location.oldLine;
  const url = `${base}/${repo}/${target.provider === "gitlab" ? "-/blob" : "blob"}/${sha}/${path}${line ? `#L${line}` : ""}`;
  return `[${escapeMarkdownInline(label)}](<${url}>)`;
}

function renderBanner(
  input: {
    readonly target?: ReviewPublicationTarget | undefined;
    readonly bannerBaseUrl?: string | undefined;
    readonly reviewState?: ReviewSummaryState | undefined;
  },
  counts: SeverityCounts,
  locale: ReviewSummaryLocale,
): string {
  const base = safeHttpsBase(input.bannerBaseUrl ?? "");
  if (
    !base ||
    input.target?.provider !== "github" ||
    (input.reviewState !== "complete" && input.reviewState !== "incomplete") ||
    [counts.critical, counts.major, counts.minor, counts.info].some(
      (count) => !Number.isInteger(count) || count < 0 || count > 9999,
    )
  )
    return "";
  const url = (theme: "light" | "dark") => {
    const query = new URLSearchParams({
      state: input.reviewState!,
      critical: String(counts.critical),
      major: String(counts.major),
      minor: String(counts.minor),
      info: String(counts.info),
      lang: locale,
      theme,
    });
    return escapeHtml(`${base}/review-banner/v1.svg?${query}`);
  };
  return `<picture>\n<source media="(prefers-color-scheme: dark)" srcset="${url("dark")}">\n<img src="${url("light")}" alt="ReviewRouter" width="640" height="110">\n</picture>`;
}

function safeHttpsBase(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
      ? url.href.replace(/\/+$/, "")
      : null;
  } catch {
    return null;
  }
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
    (left.fingerprint < right.fingerprint
      ? -1
      : left.fingerprint > right.fingerprint
        ? 1
        : 0)
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
  if (!finding.location) return "";
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
    noFindingsStatus: "No findings",
    findingsStatus: (counts) =>
      `${formatSeverityCounts(counts)} ${counts.total === 1 ? "finding" : "findings"}`,
    details: "Details",
    incomplete: "⚠️ Review incomplete. This result is not an all-clear.",
    moreFindings: (count) =>
      `**${count} more ${count === 1 ? "finding" : "findings"} omitted from this summary because of size limits.**`,
  },
  ru: {
    noFindingsStatus: "Замечаний нет",
    findingsStatus: (counts) =>
      `${formatSeverityCounts(counts)} ${slavicFindingWord(counts.total, ["замечание", "замечания", "замечаний"])}`,
    details: "Подробности",
    incomplete:
      "⚠️ Ревью не завершено. Этот результат не означает отсутствия проблем.",
    moreFindings: (count) =>
      `**Ещё ${count} ${slavicFindingWord(count, ["замечание", "замечания", "замечаний"])} не влезли в это сообщение из‑за лимита размера.**`,
  },
  uk: {
    noFindingsStatus: "Зауважень немає",
    findingsStatus: (counts) =>
      `${formatSeverityCounts(counts)} ${slavicFindingWord(counts.total, ["зауваження", "зауваження", "зауважень"])}`,
    details: "Подробиці",
    incomplete:
      "⚠️ Рев'ю не завершено. Цей результат не означає відсутності проблем.",
    moreFindings: (count) =>
      `**Ще ${count} ${slavicFindingWord(count, ["зауваження", "зауваження", "зауважень"])} не вмістилися в це повідомлення через ліміт розміру.**`,
  },
  es: {
    noFindingsStatus: "Sin hallazgos",
    findingsStatus: (counts) =>
      `${formatSeverityCounts(counts)} ${counts.total === 1 ? "hallazgo" : "hallazgos"}`,
    details: "Detalles",
    incomplete:
      "⚠️ Revisión incompleta. Este resultado no confirma la ausencia de problemas.",
    moreFindings: (count) =>
      `**${count} ${count === 1 ? "hallazgo más omitido" : "hallazgos más omitidos"} de este resumen por el límite de tamaño.**`,
  },
  pt: {
    noFindingsStatus: "Nenhum achado",
    findingsStatus: (counts) =>
      `${formatSeverityCounts(counts)} ${counts.total === 1 ? "achado" : "achados"}`,
    details: "Detalhes",
    incomplete:
      "⚠️ Revisão incompleta. Este resultado não confirma a ausência de problemas.",
    moreFindings: (count) =>
      `**Mais ${count} ${count === 1 ? "achado omitido" : "achados omitidos"} deste resumo por limite de tamanho.**`,
  },
  fr: {
    noFindingsStatus: "Aucune anomalie",
    findingsStatus: (counts) =>
      `${formatSeverityCounts(counts)} ${counts.total === 1 ? "anomalie" : "anomalies"}`,
    details: "Détails",
    incomplete:
      "⚠️ Revue incomplète. Ce résultat ne confirme pas l'absence de problèmes.",
    moreFindings: (count) =>
      `**${count} ${count === 1 ? "anomalie supplémentaire omise" : "anomalies supplémentaires omises"} de ce résumé à cause de la limite de taille.**`,
  },
  de: {
    noFindingsStatus: "Keine Befunde",
    findingsStatus: (counts) =>
      `${formatSeverityCounts(counts)} ${counts.total === 1 ? "Befund" : "Befunde"}`,
    details: "Details",
    incomplete:
      "⚠️ Review unvollständig. Dieses Ergebnis bestätigt keine Fehlerfreiheit.",
    moreFindings: (count) =>
      `**${count} weitere ${count === 1 ? "Befund" : "Befunde"} fehlen in dieser Zusammenfassung wegen des Größenlimits.**`,
  },
  it: {
    noFindingsStatus: "Nessun rilievo",
    findingsStatus: (counts) =>
      `${formatSeverityCounts(counts)} ${counts.total === 1 ? "rilievo" : "rilievi"}`,
    details: "Dettagli",
    incomplete:
      "⚠️ Revisione incompleta. Questo risultato non conferma l'assenza di problemi.",
    moreFindings: (count) =>
      `**Altri ${count} ${count === 1 ? "rilievo omesso" : "rilievi omessi"} da questo riassunto per il limite di dimensione.**`,
  },
  zh: {
    noFindingsStatus: "无问题",
    findingsStatus: (counts) => `${formatSeverityCounts(counts)} 个问题`,
    details: "详细信息",
    incomplete: "⚠️ 审查未完成。此结果不代表没有问题。",
    moreFindings: (count) => `**受篇幅限制，本摘要还省略了 ${count} 条问题。**`,
  },
  ja: {
    noFindingsStatus: "指摘なし",
    findingsStatus: (counts) => `指摘 ${formatSeverityCounts(counts)} 件`,
    details: "詳細",
    incomplete: "⚠️ レビュー未完了。この結果は問題がないことを示しません。",
    moreFindings: (count) =>
      `**サイズ制限のため、この要約から指摘がさらに ${count} 件省略されています。**`,
  },
  ko: {
    noFindingsStatus: "이슈 없음",
    findingsStatus: (counts) => `이슈 ${formatSeverityCounts(counts)}개`,
    details: "세부 정보",
    incomplete:
      "⚠️ 검토가 완료되지 않았습니다. 이 결과는 문제가 없음을 의미하지 않습니다.",
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
  return escapeHtml(value.replace(/\s+/g, " "))
    .replaceAll("\\", "\\\\")
    .replace(/([`*_[\]~])/g, "\\$1");
}

function utf8Bytes(value: string): number {
  return Buffer.byteLength(value, "utf8");
}
