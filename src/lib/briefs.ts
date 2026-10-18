export type BriefPhoto = { name: string; url: string };
export type Brief = { id: string; date: string; title: string; body: string; status: "draft" | "published"; photos: BriefPhoto[] };
export const MAX_BRIEF_PHOTOS = 10;
export const MAX_BRIEF_PHOTO_BYTES = 10 * 1024 * 1024;
export function photoError(files: { type: string; size: number }[], existing = 0): string | null {
  if (files.length + existing > MAX_BRIEF_PHOTOS) return "Ən çox 10 foto əlavə etmək olar.";
  if (files.some(file => !["image/jpeg", "image/png", "image/webp"].includes(file.type))) return "Yalnız JPG, PNG və WebP qəbul edilir.";
  if (files.some(file => file.size > MAX_BRIEF_PHOTO_BYTES)) return "Hər foto ən çox 10 MB ola bilər.";
  return null;
}
export function conflictingBrief(briefs: Brief[], date: string, id?: string) {
  return briefs.find(brief => brief.date === date && brief.id !== id);
}
export const demoBriefs: Brief[] = Array.from({ length: 9 }, (_, index) => ({
  id: `brief-${18 - index}`, date: `2026-10-${String(18 - index).padStart(2, "0")}`,
  title: "[Brifin başlığı]",
  body: Array.from({ length: 5 }, (_, paragraph) => `[Brifin mətni, uzun mətn. Abzas ${paragraph + 1}: əsas məlumat, təhlil və nəticələr burada yerləşir. Mətn istənilən uzunluqda ola bilər.]`).join("\n\n"),
  status: index === 4 ? "draft" : "published", photos: [],
}));
export function briefDate(date: string) {
  const value = new Date(`${date}T12:00:00`);
  return { day: String(value.getDate()), month: value.toLocaleDateString("az-AZ", { month: "long", year: "numeric" }), weekday: value.toLocaleDateString("az-AZ", { weekday: "long" }) };
}
export function briefHead(title: string, description: string) {
  return { meta: [{ title: `${title} · Gündəlik xülasələr` }, { name: "description", content: description }, { property: "og:title", content: `${title} · Gündəlik xülasələr` }, { property: "og:description", content: description }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary_large_image" }] };
}