const CHUNK = 1024 * 1024;
/** Each request repeats live ACL. URLs are same-origin authenticated app paths only. */
export async function loadPrivateImage(url: string, signal: AbortSignal) {
  if (!/^\/api\/attachments\/(document|brief)\//.test(url)) throw new Error("Şəkil əlçatan deyil.");
  const parts: ArrayBuffer[] = [];
  let total = 0;
  let offset = 0;
  let mime = "";
  do {
    signal.throwIfAborted();
    const response = await fetch(url, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
      cache: "no-store",
      credentials: "same-origin",
      headers: { range: `bytes=${offset}-${offset + CHUNK - 1}` },
    });
    if (response.status !== 206)
      throw new Error("Şəkil əlçatan deyil. İcazəni yoxlayın və yenidən cəhd edin.");
    const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get("content-range") ?? "");
    if (!match || Number(match[1]) !== offset) throw new Error("Şəkli yükləmək mümkün olmadı.");
    const nextTotal = Number(match[3]);
    if (nextTotal < 1 || nextTotal > 10 * CHUNK || (total && total !== nextTotal))
      throw new Error("Şəklin ölçüsü düzgün deyil.");
    total = nextTotal;
    const nextMime = response.headers.get("content-type") ?? "";
    if (
      !["image/jpeg", "image/png", "image/webp"].includes(nextMime) ||
      (mime && mime !== nextMime)
    )
      throw new Error("Şəklin formatı düzgün deyil.");
    mime = nextMime;
    const bytes = await response.arrayBuffer();
    if (
      bytes.byteLength !== Number(match[2]) - offset + 1 ||
      bytes.byteLength > CHUNK ||
      !bytes.byteLength
    )
      throw new Error("Şəkil natamamdır.");
    parts.push(bytes);
    offset += bytes.byteLength;
  } while (offset < total);
  if (offset !== total) throw new Error("Şəkil natamamdır.");
  return new Blob(parts, { type: mime });
}
