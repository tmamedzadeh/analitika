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

export interface StorageProvider {
  put(object: StorageObject): Promise<void>;
  getSignedUrl(key: string, expiresInSeconds?: number): Promise<string>;
  getSignedUploadUrl(key: string, contentType: string, expiresInSeconds?: number): Promise<string>;
  getMetadata(key: string): Promise<StoredObjectMetadata>;
  getPrefix(key: string, length: number): Promise<Uint8Array>;
  listObjects(prefix: string): Promise<StoredObjectSummary[]>;
  delete(key: string): Promise<void>;
}
