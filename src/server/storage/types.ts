export type StorageObject = {
  key: string;
  body: Uint8Array;
  contentType: string;
};

export interface StorageProvider {
  put(object: StorageObject): Promise<void>;
  getSignedUrl(key: string, expiresInSeconds?: number): Promise<string>;
  delete(key: string): Promise<void>;
}
