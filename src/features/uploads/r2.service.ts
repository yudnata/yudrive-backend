import {
  PutObjectCommand,
  GetObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  CopyObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { s3Client } from '../../config/s3';
import { env } from '../../config/env';

export class R2Service {
  private bucket: string = env.R2_BUCKET;

  // Single presigned PUT URL (default 15 minutes = 900s)
  async getPresignedPutUrl(
    key: string,
    contentType: string,
    expiresIn = 900
  ): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
    });
    return getSignedUrl(s3Client, command, { expiresIn });
  }

  // Presigned GET URL (default 1 hour = 3600s)
  async getPresignedGetUrl(key: string, expiresIn = 3600): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    return getSignedUrl(s3Client, command, { expiresIn });
  }

  // Initiate multipart upload for large files (> 50 MB)
  async createMultipartUpload(key: string, contentType: string): Promise<string> {
    const command = new CreateMultipartUploadCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
    });
    const res = await s3Client.send(command);
    if (!res.UploadId) {
      throw new Error('Gagal menginisialisasi multipart upload di R2.');
    }
    return res.UploadId;
  }

  // Presigned URL for an individual part
  async getPresignedUploadPartUrl(
    key: string,
    uploadId: string,
    partNumber: number,
    expiresIn = 900
  ): Promise<string> {
    const command = new UploadPartCommand({
      Bucket: this.bucket,
      Key: key,
      UploadId: uploadId,
      PartNumber: partNumber,
    });
    return getSignedUrl(s3Client, command, { expiresIn });
  }

  // Complete multipart upload
  async completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: Array<{ PartNumber: number; ETag: string }>
  ): Promise<void> {
    const sortedParts = [...parts].sort((a, b) => a.PartNumber - b.PartNumber);
    const command = new CompleteMultipartUploadCommand({
      Bucket: this.bucket,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: {
        Parts: sortedParts,
      },
    });
    await s3Client.send(command);
  }

  // Abort incomplete multipart upload
  async abortMultipartUpload(key: string, uploadId: string): Promise<void> {
    const command = new AbortMultipartUploadCommand({
      Bucket: this.bucket,
      Key: key,
      UploadId: uploadId,
    });
    await s3Client.send(command);
  }

  // Inspect object metadata and verify file size
  async headObject(key: string): Promise<{ sizeBytes: number; mime?: string }> {
    const command = new HeadObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    const res = await s3Client.send(command);
    return {
      sizeBytes: res.ContentLength || 0,
      mime: res.ContentType,
    };
  }

  // Delete single object from R2
  async deleteObject(key: string): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    await s3Client.send(command);
  }

  // Copy object within R2
  async copyObject(sourceKey: string, destinationKey: string): Promise<void> {
    const command = new CopyObjectCommand({
      Bucket: this.bucket,
      CopySource: `${this.bucket}/${encodeURI(sourceKey)}`,
      Key: destinationKey,
    });
    await s3Client.send(command);
  }
}

export const r2Service = new R2Service();
