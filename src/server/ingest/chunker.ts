export type DocumentChunk = {
  ord: number;
  sectionTitle: string;
  text: string;
  embeddingText: string;
  charStart: number;
  charEnd: number;
  isTable: boolean;
};

type Line = { text: string; start: number; end: number; next: number };

const DEFAULT_TARGET_CHARS = 1800;
const DEFAULT_OVERLAP_CHARS = 216;

function readLines(body: string): Line[] {
  const lines: Line[] = [];
  let start = 0;

  while (start < body.length) {
    const newline = body.indexOf("\n", start);
    const next = newline === -1 ? body.length : newline + 1;
    const end =
      newline === -1
        ? body.length
        : newline > start && body[newline - 1] === "\r"
          ? newline - 1
          : newline;
    lines.push({ text: body.slice(start, end), start, end, next });
    start = next;
  }

  if (body.length === 0) return [];
  return lines;
}

function trimRange(body: string, start: number, end: number): { start: number; end: number } {
  while (start < end && /\s/.test(body[start] ?? "")) start += 1;
  while (end > start && /\s/.test(body[end - 1] ?? "")) end -= 1;
  return { start, end };
}

function findBreak(body: string, start: number, limit: number): number {
  if (limit >= body.length) return body.length;
  const preferred = start + Math.floor((limit - start) * 0.65);
  for (let index = limit; index >= preferred; index -= 1) {
    if (/\s/.test(body[index - 1] ?? "")) return index - 1;
  }
  for (let index = limit; index > start; index -= 1) {
    if (/\s/.test(body[index - 1] ?? "")) return index - 1;
  }
  return limit;
}

function splitRange(
  body: string,
  start: number,
  end: number,
  targetChars: number,
  overlapChars: number,
): Array<{ text: string; charStart: number; charEnd: number }> {
  const chunks: Array<{ text: string; charStart: number; charEnd: number }> = [];
  let cursor = start;

  while (cursor < end) {
    const limit = Math.min(cursor + targetChars, end);
    let chunkEnd = limit < end ? findBreak(body, cursor, limit) : end;
    if (chunkEnd <= cursor) chunkEnd = limit;
    const trimmed = trimRange(body, cursor, chunkEnd);
    if (trimmed.end > trimmed.start) {
      chunks.push({
        text: body.slice(trimmed.start, trimmed.end),
        charStart: trimmed.start,
        charEnd: trimmed.end,
      });
    }
    if (chunkEnd >= end) break;

    let next = Math.max(cursor + 1, chunkEnd - overlapChars);
    while (next < chunkEnd && !/\s/.test(body[next] ?? "")) next += 1;
    while (next < end && /\s/.test(body[next] ?? "")) next += 1;
    cursor = next > cursor ? next : chunkEnd;
  }

  return chunks;
}

function isTableLine(line: string): boolean {
  return line.includes("|");
}

function isSeparatorRow(line: string): boolean {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells = trimmed.split("|");
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

function makeTableChunks(
  body: string,
  lines: Line[],
  sectionTitle: string,
  title: string,
  targetChars: number,
): Array<Omit<DocumentChunk, "ord">> {
  if (lines.length === 0) return [];
  const headerCount = lines.length > 1 && isSeparatorRow(lines[1]?.text ?? "") ? 2 : 1;
  const headerLines = lines.slice(0, headerCount);
  const dataLines = lines.slice(headerCount);
  const headerText = headerLines.map((line) => line.text.trim()).join("\n");
  const prefix = sectionTitle ? `# ${sectionTitle}\n` : "";
  const contentLines: Line[][] = [];
  let group: Line[] = [];
  let groupLength = prefix.length + headerText.length;

  for (const line of dataLines) {
    const lineText = line.text.trim();
    const addedLength = lineText.length + 1;
    if (group.length > 0 && groupLength + addedLength > targetChars) {
      contentLines.push(group);
      group = [];
      groupLength = prefix.length + headerText.length;
    }
    group.push(line);
    groupLength += addedLength;
  }
  if (group.length > 0) contentLines.push(group);
  if (contentLines.length === 0) contentLines.push([]);

  return contentLines.map((tableRows) => {
    const rowText = tableRows.map((line) => line.text.trim()).join("\n");
    const text = [prefix.trimEnd(), headerText, rowText].filter(Boolean).join("\n");
    const charStart = tableRows[0]?.start ?? headerLines[0]?.start ?? 0;
    const charEnd = tableRows.at(-1)?.end ?? headerLines.at(-1)?.end ?? charStart;
    return {
      sectionTitle,
      text,
      embeddingText: `${title} / ${sectionTitle}\n${text}`.trim(),
      charStart: trimRange(body, charStart, charEnd).start,
      charEnd: trimRange(body, charStart, charEnd).end,
      isTable: true,
    };
  });
}

export function chunkDocument(
  body: string,
  title: string,
  options: { targetChars?: number; overlapChars?: number } = {},
): DocumentChunk[] {
  const targetChars = Math.max(128, options.targetChars ?? DEFAULT_TARGET_CHARS);
  const overlapChars = Math.min(
    Math.floor(targetChars * 0.15),
    Math.max(0, options.overlapChars ?? DEFAULT_OVERLAP_CHARS),
  );
  const lines = readLines(body);
  const chunks: Array<Omit<DocumentChunk, "ord">> = [];
  let sectionTitle = "";
  let cursor = 0;

  while (cursor < lines.length) {
    const line = lines[cursor];
    if (!line) break;
    const heading = line.text.match(/^\s*#{1,6}\s+(.+?)\s*#*\s*$/);
    if (heading) {
      sectionTitle = heading[1]?.trim() ?? "";
      cursor += 1;
      continue;
    }
    if (!line.text.trim()) {
      cursor += 1;
      continue;
    }

    if (isTableLine(line.text)) {
      const tableLines: Line[] = [];
      while (cursor < lines.length && isTableLine(lines[cursor]?.text ?? "")) {
        const tableLine = lines[cursor];
        if (tableLine) tableLines.push(tableLine);
        cursor += 1;
      }
      chunks.push(...makeTableChunks(body, tableLines, sectionTitle, title, targetChars));
      continue;
    }

    const blockLines: Line[] = [line];
    cursor += 1;
    while (cursor < lines.length) {
      const nextLine = lines[cursor];
      if (!nextLine || isTableLine(nextLine.text) || /^\s*#{1,6}\s+/.test(nextLine.text)) {
        break;
      }
      blockLines.push(nextLine);
      cursor += 1;
    }
    const start = blockLines[0]?.start ?? 0;
    const end = blockLines.at(-1)?.end ?? start;
    for (const part of splitRange(body, start, end, targetChars, overlapChars)) {
      chunks.push({
        sectionTitle,
        text: part.text,
        embeddingText: `${title} / ${sectionTitle}\n${part.text}`.trim(),
        charStart: part.charStart,
        charEnd: part.charEnd,
        isTable: false,
      });
    }
  }

  return chunks.map((chunk, ord) => ({ ...chunk, ord }));
}
