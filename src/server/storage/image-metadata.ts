export type ImageMetadata = {
  width: number;
  height: number;
  sha256: string;
  derivative: {
    key: string;
    mime: "image/webp";
    size: number;
    width: number;
    height: number;
  } | null;
};

export function attachmentKeys(file: {
  storageKey: string;
  imageMetadata?: ImageMetadata | null | undefined;
}): string[] {
  return [
    file.storageKey,
    ...(file.imageMetadata?.derivative ? [file.imageMetadata.derivative.key] : []),
  ];
}
