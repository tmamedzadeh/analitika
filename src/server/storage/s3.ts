import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl as presignUrl } from "@aws-sdk/s3-request-presigner";

import { requireServerEnv } from "../env";
import type { StorageObject, StorageProvider } from "./types";

export class S3Storage implements StorageProvider {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor() {
    this.bucket = requireServerEnv("S3_BUCKET");
    this.client = new S3Client({
      endpoint: requireServerEnv("S3_ENDPOINT"),
      region: requireServerEnv("S3_REGION"),
      forcePathStyle: true,
      credentials: {
        accessKeyId: requireServerEnv("S3_ACCESS_KEY_ID"),
        secretAccessKey: requireServerEnv("S3_SECRET_ACCESS_KEY"),
      },
    });
  }

  async put({ key, body, contentType }: StorageObject): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async getSignedUrl(key: string, expiresInSeconds = 3600): Promise<string> {
    const expiresIn = Math.min(Math.max(Math.floor(expiresInSeconds), 1), 3600);
    return presignUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
      { expiresIn },
    );
  }

  async getSignedUploadUrl(
    key: string,
    contentType: string,
    expiresInSeconds = 300,
  ): Promise<string> {
    const expiresIn = Math.min(Math.max(Math.floor(expiresInSeconds), 1), 900);
    return presignUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: contentType,
      }),
      { expiresIn },
    );
  }

  async getMetadata(key: string) {
    const result = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
    if (result.ContentLength === undefined)
      throw new Error("Storage obyektinin ölçüsü qaytarılmadı.");
    return {
      size: result.ContentLength,
      ...(result.ContentType ? { contentType: result.ContentType } : {}),
    };
  }

  async getPrefix(key: string, length: number): Promise<Uint8Array> {
    const byteCount = Math.max(1, Math.min(Math.floor(length), 64));
    const result = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Range: `bytes=0-${byteCount - 1}`,
      }),
    );
    if (!result.Body) throw new Error("Storage faylın məzmununu qaytarmadı.");
    const bytes = await result.Body.transformToByteArray();
    return bytes.slice(0, byteCount);
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );
  }

  close(): void {
    this.client.destroy();
  }
}

let storage: S3Storage | undefined;

export function getStorage(): StorageProvider {
  storage ??= new S3Storage();
  return storage;
}

export function closeStorage(): void {
  storage?.close();
  storage = undefined;
}
