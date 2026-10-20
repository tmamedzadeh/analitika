export function plainTextFragment(value: string, maximum = 300): string {
  const plain = value
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]*>/g, " ")
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+\.\s+)/gm, "")
    .replace(/[*_~`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (plain.length <= maximum) return plain;
  const fragment = plain.slice(0, maximum + 1);
  const boundary = fragment.lastIndexOf(" ");
  return (boundary > 0 ? fragment.slice(0, boundary) : fragment.slice(0, maximum)).trim();
}
