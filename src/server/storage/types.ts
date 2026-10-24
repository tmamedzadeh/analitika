export type StorageObject = {
  key: string;
  body: Uint8Array;
  contentType: string;
};

export type StoredObjectMetadata = {
  size: number;
  contentType?: string;
};

export type StoredObjectSummary = {
  key: string;
  lastModified: Date;
};

export type StoredObjectStream = {
  body: ReadableStream<Uint8Array>;
  size?: number;
  contentType?: string;
};

export type StorageOptions = {
  signal?: AbortSignal | undefined;
  timeoutMs?: number | undefined;
  range?: { start: number; end: number } | undefined;
};

export interface StorageProvider {
  put(object: StorageObject, options?: StorageOptions): Promise<void>;
  getSignedUrl(key: string, expiresInSeconds?: number): Promise<string>;
  getSignedUploadUrl(
    key: string,
    contentType: string,
    size: number,
    expiresInSeconds?: number,
  ): Promise<string>;
  getMetadata(key: string, options?: StorageOptions): Promise<StoredObjectMetadata>;
  getPrefix(key: string, length: number): Promise<Uint8Array>;
  getObjectStream(key: string, options?: StorageOptions): Promise<StoredObjectStream>;
  listObjects(prefix: string, options?: StorageOptions): Promise<StoredObjectSummary[]>;
  delete(key: string, options?: StorageOptions): Promise<void>;
}
