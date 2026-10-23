const copy = {
  en: [
    "Review complete",
    "Review incomplete",
    "No findings",
    "critical",
    "major",
    "minor",
    "info",
  ],
  ru: [
    "Ревью завершено",
    "Ревью не завершено",
    "Замечаний нет",
    "critical",
    "major",
    "minor",
    "info",
  ],
  uk: [
    "Ревʼю завершено",
    "Ревʼю не завершено",
    "Зауважень немає",
    "critical",
    "major",
    "minor",
    "info",
  ],
  es: [
    "Revisión completada",
    "Revisión incompleta",
    "Sin hallazgos",
    "crítico",
    "grave",
    "menor",
    "info",
  ],
  pt: [
    "Revisão concluída",
    "Revisão incompleta",
    "Nenhum achado",
    "crítico",
    "grave",
    "menor",
    "info",
  ],
  fr: [
    "Revue terminée",
    "Revue incomplète",
    "Aucune anomalie",
    "critique",
    "majeur",
    "mineur",
    "info",
  ],
  de: [
    "Review abgeschlossen",
    "Review unvollständig",
    "Keine Befunde",
    "kritisch",
    "schwer",
    "gering",
    "Info",
  ],
  it: [
    "Revisione completata",
    "Revisione incompleta",
    "Nessun rilievo",
    "critico",
    "grave",
    "minore",
    "info",
  ],
  zh: ["审查完成", "审查未完成", "无问题", "严重", "主要", "次要", "提示"],
  ja: [
    "レビュー完了",
    "レビュー未完了",
    "指摘なし",
    "重大",
    "主要",
    "軽微",
    "情報",
  ],
  ko: ["리뷰 완료", "리뷰 미완료", "이슈 없음", "심각", "주요", "경미", "정보"],
} as const;

type Locale = keyof typeof copy;
const severities = ["critical", "major", "minor", "info"] as const;
const allowed = new Set(["state", "lang", "theme", ...severities]);

type BannerInput = {
  state: "complete" | "incomplete";
  lang: Locale;
  theme: "light" | "dark";
  counts: readonly number[];
};

function parseBannerInput(url: URL): BannerInput | null {
  const params = url.searchParams;
  if (
    [...params.keys()].some(
      (key) => !allowed.has(key) || params.getAll(key).length !== 1,
    )
  )
    return null;
  const state = params.get("state");
  const lang = params.get("lang") ?? "en";
  const theme = params.get("theme") ?? "dark";
  if (state !== "complete" && state !== "incomplete") return null;
  if (!Object.hasOwn(copy, lang) || (theme !== "light" && theme !== "dark"))
    return null;
  const counts = severities.map((severity) => params.get(severity) ?? "0");
  if (counts.some((count) => !/^(?:0|[1-9][0-9]{0,3})$/.test(count)))
    return null;
  return { state, lang: lang as Locale, theme, counts: counts.map(Number) };
}

const escapeXml = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

function renderBanner(input: BannerInput): string {
  const labels = copy[input.lang];
  const palette =
    input.theme === "dark"
      ? {
          background: "#151b23",
          text: "#f0f6fc",
          muted: "#a0a9b4",
          colors: ["#ff8b8e", "#e3b341", "#79c0ff", "#a0a9b4"],
        }
      : {
          background: "#f6f8fa",
          text: "#1f2328",
          muted: "#59636e",
          colors: ["#b4232d", "#7d4e00", "#0969da", "#59636e"],
        };
  const active = input.counts.flatMap((count, index) =>
    count > 0 ? [{ count, index }] : [],
  );
  const status =
    input.state === "incomplete"
      ? labels[1]
      : active.length === 0
        ? labels[2]
        : labels[0];
  const descriptions = active.map(
    ({ count, index }) => `${count} ${labels[index + 3]}`,
  );
  const metrics = active
    .map(({ count, index }, position) => {
      const x = 24 + position * 148;
      return `<text x="${x}" y="88" fill="${palette.colors[index]}" font-size="17" font-weight="600">${count}</text><text x="${x + String(count).length * 11 + 7}" y="88" fill="${palette.text}" font-size="13">${escapeXml(labels[index + 3] ?? "")}</text>`;
    })
    .join("");
  const title = escapeXml(
    ["ReviewRouter", status, ...descriptions].join(" · "),
  );
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="110" viewBox="0 0 640 110" role="img" aria-labelledby="title"><title id="title">${title}</title><rect width="640" height="110" rx="6" fill="${palette.background}"/><g font-family="Arial,Helvetica,sans-serif"><text x="24" y="26" fill="${palette.muted}" font-size="13">ReviewRouter</text><text x="24" y="55" fill="${palette.text}" font-size="22" font-weight="600">${escapeXml(status)}</text>${metrics}</g></svg>`;
}

export function legacyReviewBannerSvg(url: URL): string | null {
  const input = parseBannerInput(url);
  return input ? renderBanner(input) : null;
}
