function decodeWith(label: string | undefined, bytes: Uint8Array): string | undefined {
  if (!label) return undefined;
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return undefined;
  }
}

function charsetFromHeader(contentType: string): string | undefined {
  return /\bcharset\s*=\s*["']?([^;\s"']+)/i.exec(contentType)?.[1];
}

function charsetFromMeta(prefix: string): string | undefined {
  for (const tag of prefix.matchAll(/<meta\b[^>]*>/gi)) {
    const text = tag[0];
    const direct = /\bcharset\s*=\s*["']?([^\s"'/>;]+)/i.exec(text)?.[1];
    if (direct) return direct;
    if (!/\bhttp-equiv\s*=\s*["']?content-type/i.test(text)) continue;
    const content = /\bcontent\s*=\s*["']([^"']*)["']/i.exec(text)?.[1] ?? text;
    const nested = /\bcharset\s*=\s*["']?([^;\s"']+)/i.exec(content)?.[1];
    if (nested) return nested;
  }
  return undefined;
}

export function decodeHtmlBytes(bytes: Uint8Array, contentType: string): string {
  const headerLabel = charsetFromHeader(contentType);
  const headerDecoded = decodeWith(headerLabel, bytes);
  if (headerDecoded !== undefined) return headerDecoded;

  const prefix = new TextDecoder("utf-8").decode(bytes.subarray(0, 4096));
  const metaDecoded = decodeWith(charsetFromMeta(prefix), bytes);
  return metaDecoded ?? new TextDecoder("utf-8").decode(bytes);
}
