import { az } from "@/lib/i18n/az";

export type CopyCited = { text: string; sourceNumbers: readonly number[] };

export type CopyReport = {
  bluf: string;
  blufSourceNumbers: readonly number[];
  keyFindings: readonly CopyCited[];
  entities: readonly { name: string; sourceNumbers: readonly number[] }[];
  timeline: readonly { date: string; event: string; sourceNumbers: readonly number[] }[];
  perspectives: readonly { group: string; summary: string; sourceNumbers: readonly number[] }[];
  disagreements: readonly {
    topic: string;
    positions: readonly { group: string; text: string; sourceNumbers: readonly number[] }[];
  }[];
  gaps: readonly CopyCited[];
  watch: readonly CopyCited[];
  caveats: readonly CopyCited[];
};

export type CopySource = {
  n: number;
  title: string;
  domain: string;
  url: string;
  publishedAt: string | null;
};

export type CopyReportInput = {
  applicationOrigin?: string;
  query: string;
  periodLabel: string;
  languageLabels: readonly string[];
  generatedAt: string;
  report: CopyReport;
  sources: readonly CopySource[];
};

type LeadStyle = "colon" | "dash" | "title";
type Item = {
  lead?: string;
  leadStyle?: LeadStyle;
  text: string;
  numbers: number[];
  children?: Item[];
};
type Section = { heading: string; paragraph?: Item; items?: Item[] };
type SourceLine = { n: number; title: string; domain: string; date: string | null; url: string };
type CopyDocument = {
  meta: { label: string; value: string }[];
  sections: Section[];
  sources: SourceLine[];
};

const labels = az.osint.copy;

function oneLine(value: string): string {
  return value
    .replace(/\p{Cc}/gu, " ")
    .replace(/[\u202A-\u202E\u2066-\u2069]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function safeUrl(value: string, applicationOrigin?: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (applicationOrigin && url.origin === new URL(applicationOrigin).origin) return null;
    return url.href;
  } catch {
    return null;
  }
}

function formatDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return day + "." + month + "." + date.getUTCFullYear();
}

function mdText(value: string): string {
  return oneLine(value).replace(/[\\[\]<>]/g, (char) => "\\" + char);
}

function mdBlock(value: string): string {
  return mdText(value)
    .replace(/^([#>+*-])/, "\\$1")
    .replace(/^(\d+)([.)])/, "$1\\$2");
}

function htmlText(value: string): string {
  return oneLine(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildDocument(input: CopyReportInput): CopyDocument {
  const known = new Set(input.sources.map((source) => source.n));
  const keep = (numbers: readonly number[]) => numbers.filter((number) => known.has(number));
  const cited = (items: readonly CopyCited[]): Item[] =>
    items.map((item) => ({ text: item.text, numbers: keep(item.sourceNumbers) }));
  const { report } = input;
  const sections: Section[] = [];
  const used = new Set<number>();
  const track = (items: readonly Item[]) => {
    for (const item of items) {
      for (const number of item.numbers) used.add(number);
      if (item.children) track(item.children);
    }
  };
  const push = (section: Section) => {
    sections.push(section);
    if (section.paragraph) track([section.paragraph]);
    if (section.items) track(section.items);
  };

  push({
    heading: labels.bluf,
    paragraph: { text: report.bluf, numbers: keep(report.blufSourceNumbers) },
  });
  if (report.keyFindings.length) {
    push({ heading: labels.keyFindings, items: cited(report.keyFindings) });
  }
  if (report.entities.length) {
    push({
      heading: labels.entities,
      items: report.entities.map((entity) => ({
        text: entity.name,
        numbers: keep(entity.sourceNumbers),
      })),
    });
  }
  if (report.timeline.length) {
    push({
      heading: labels.timeline,
      items: report.timeline.map((item) => ({
        lead: item.date,
        leadStyle: "dash" as const,
        text: item.event,
        numbers: keep(item.sourceNumbers),
      })),
    });
  }
  const positions: Item[] = report.perspectives.map((item) => ({
    lead: item.group,
    leadStyle: "colon" as const,
    text: item.summary,
    numbers: keep(item.sourceNumbers),
  }));
  if (positions.length) push({ heading: labels.perspectives, items: positions });
  const disagreements: Item[] = report.disagreements.map((item) => ({
    lead: item.topic,
    leadStyle: "title" as const,
    text: "",
    numbers: [] as number[],
    children: item.positions.map((position) => ({
      lead: position.group,
      leadStyle: "colon" as const,
      text: position.text,
      numbers: keep(position.sourceNumbers),
    })),
  }));
  if (disagreements.length) push({ heading: labels.disagreements, items: disagreements });
  if (report.gaps.length) push({ heading: labels.gaps, items: cited(report.gaps) });
  if (report.watch.length) push({ heading: labels.watch, items: cited(report.watch) });
  if (report.caveats.length) push({ heading: labels.caveats, items: cited(report.caveats) });

  const sources = input.sources
    .filter((source) => used.has(source.n))
    .sort((left, right) => left.n - right.n)
    .map((source) => ({
      n: source.n,
      title: source.title,
      domain: source.domain,
      date: formatDate(source.publishedAt),
      url: safeUrl(source.url, input.applicationOrigin) ?? "",
    }));

  return {
    meta: [
      { label: labels.query, value: input.query },
      { label: labels.period, value: input.periodLabel },
      { label: labels.languages, value: input.languageLabels.join(", ") },
      { label: labels.generatedAt, value: input.generatedAt },
    ].filter((item) => oneLine(item.value)),
    sections,
    sources,
  };
}

const citationText = (numbers: readonly number[]) =>
  numbers.map((number) => "[" + number + "]").join(" ");

function markdownLead(item: Item): string {
  if (!item.lead) return "";
  const lead = mdText(item.lead);
  if (item.leadStyle === "colon") return "**" + lead + ":** ";
  if (item.leadStyle === "dash") return "**" + lead + "** — ";
  return "**" + lead + "**";
}

function markdownItem(item: Item, indent: string): string[] {
  const cites = item.numbers.length ? " " + citationText(item.numbers) : "";
  const lines = [indent + "- " + markdownLead(item) + mdText(item.text) + cites];
  for (const child of item.children ?? []) lines.push(...markdownItem(child, indent + "  "));
  return lines;
}

function markdownSourceLine(source: SourceLine): string {
  const parts = [mdText(source.title) + " — " + mdText(source.domain)];
  if (source.date) parts.push(source.date);
  if (source.url) parts.push(source.url);
  return "[" + source.n + "] " + parts.join(", ");
}

export function buildReportMarkdown(input: CopyReportInput): string {
  const doc = buildDocument(input);
  const lines: string[] = doc.meta.flatMap((item) => [
    "**" + item.label + ":** " + mdText(item.value),
    "",
  ]);
  for (const section of doc.sections) {
    lines.push("## " + section.heading, "");
    if (section.paragraph) {
      const cites = section.paragraph.numbers.length
        ? " " + citationText(section.paragraph.numbers)
        : "";
      lines.push(mdBlock(section.paragraph.text) + cites, "");
    }
    if (section.items?.length) {
      for (const item of section.items) lines.push(...markdownItem(item, ""));
      lines.push("");
    }
  }
  if (doc.sources.length) {
    lines.push("## " + labels.sources, "");
    lines.push(...doc.sources.map(markdownSourceLine));
  }
  return lines.join("\n").trim() + "\n";
}

function htmlLead(item: Item): string {
  if (!item.lead) return "";
  const lead = htmlText(item.lead);
  if (item.leadStyle === "colon") return "<strong>" + lead + ":</strong> ";
  if (item.leadStyle === "dash") return "<strong>" + lead + "</strong> — ";
  return "<strong>" + lead + "</strong>";
}

function htmlItem(item: Item): string {
  const cites = item.numbers.length ? " " + htmlText(citationText(item.numbers)) : "";
  const children = item.children?.length
    ? "<ul>" + item.children.map(htmlItem).join("") + "</ul>"
    : "";
  return "<li>" + htmlLead(item) + htmlText(item.text) + cites + children + "</li>";
}

function htmlSourceLine(source: SourceLine): string {
  const url = source.url
    ? '<a href="' + htmlText(source.url) + '">' + htmlText(source.url) + "</a>"
    : "";
  const details = [htmlText(source.domain), source.date ? htmlText(source.date) : "", url]
    .filter(Boolean)
    .join(", ");
  return "<p>[" + source.n + "] " + htmlText(source.title) + " — " + details + "</p>";
}

export function buildReportHtml(input: CopyReportInput): string {
  const doc = buildDocument(input);
  const parts: string[] = doc.meta.map(
    (item) => "<p><strong>" + htmlText(item.label) + ":</strong> " + htmlText(item.value) + "</p>",
  );
  for (const section of doc.sections) {
    parts.push("<h2>" + htmlText(section.heading) + "</h2>");
    if (section.paragraph) {
      const cites = section.paragraph.numbers.length
        ? " " + htmlText(citationText(section.paragraph.numbers))
        : "";
      parts.push("<p>" + htmlText(section.paragraph.text) + cites + "</p>");
    }
    if (section.items?.length) parts.push("<ul>" + section.items.map(htmlItem).join("") + "</ul>");
  }
  if (doc.sources.length) {
    parts.push("<h2>" + htmlText(labels.sources) + "</h2>");
    parts.push(...doc.sources.map(htmlSourceLine));
  }
  return "<div>" + parts.join("") + "</div>";
}

export type ClipboardLike = {
  write?(items: unknown[]): Promise<void>;
  writeText?(text: string): Promise<void>;
};
export type ClipboardItemConstructor = new (items: Record<string, Blob>) => unknown;

export async function writeReportToClipboard(
  report: { markdown: string; html: string },
  options: { clipboard?: ClipboardLike; itemConstructor?: ClipboardItemConstructor } = {},
): Promise<boolean> {
  const clipboard =
    options.clipboard ?? (typeof navigator === "undefined" ? undefined : navigator.clipboard);
  const itemConstructor =
    options.itemConstructor ??
    (typeof ClipboardItem === "undefined"
      ? undefined
      : (ClipboardItem as unknown as ClipboardItemConstructor));
  if (!clipboard) return false;
  if (clipboard.write && itemConstructor) {
    try {
      await clipboard.write([
        new itemConstructor({
          "text/plain": new Blob([report.markdown], { type: "text/plain" }),
          "text/html": new Blob([report.html], { type: "text/html" }),
        }),
      ]);
      return true;
    } catch {
      // Fall back to plain text below.
    }
  }
  if (!clipboard.writeText) return false;
  try {
    await clipboard.writeText(report.markdown);
    return true;
  } catch {
    return false;
  }
}
