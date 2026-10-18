export type StorageObject = {
  key: string;
  body: Uint8Array;
  contentType: string;
};

export type StoredObjectMetadata = {
  size: number;
  contentType?: string;
};

export interface StorageProvider {
  put(object: StorageObject): Promise<void>;
  getSignedUrl(key: string, expiresInSeconds?: number): Promise<string>;
  getSignedUploadUrl(key: string, contentType: string, expiresInSeconds?: number): Promise<string>;
  getMetadata(key: string): Promise<StoredObjectMetadata>;
  getPrefix(key: string, length: number): Promise<Uint8Array>;
  delete(key: string): Promise<void>;
}
