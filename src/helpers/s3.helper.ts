import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { v4 as uuidv4 } from "uuid";
import { ENV } from "../config/env";

// When running on App Runner with IAM role, credentials are auto-provided
// No need to pass accessKeyId/secretAccessKey manually
const s3Client = new S3Client({
  region: ENV.AWS_REGION,
});

export const uploadToS3 = async (
  fileBuffer: Buffer,
  mimeType: string,
  folder: string = "general"
): Promise<string> => {
  const key = `${folder}/${uuidv4()}-${Date.now()}`;
  const command = new PutObjectCommand({
    Bucket: ENV.AWS_S3_BUCKET,
    Key: key,
    Body: fileBuffer,
    ContentType: mimeType,
  });
  await s3Client.send(command);
  return `https://${ENV.AWS_S3_BUCKET}.s3.${ENV.AWS_REGION}.amazonaws.com/${key}`;
};

export const getPresignedUrl = async (
  fileUrl: string,
  expiresInSeconds: number = 900
): Promise<string> => {
  const key = fileUrl.split(".amazonaws.com/")[1];
  if (!key) throw new Error("Invalid S3 URL");
  const command = new GetObjectCommand({
    Bucket: ENV.AWS_S3_BUCKET,
    Key: key,
  });
  return getSignedUrl(s3Client, command, { expiresIn: expiresInSeconds });
};

/**
 * Signs a list of stored URLs for reading, falling back to the raw URL for any that cannot be signed.
 *
 * Used for the two prefixes that are deliberately **not** in the bucket policy — `disputes/` and
 * `bookings/` — where the raw URL 403s for everyone. That is correct storage for damage claims, and
 * useless to a client, so every read hands back a short-lived signed URL instead.
 *
 * Three decisions worth keeping:
 *
 * - **A signing failure returns the raw URL, it does not fail the read.** A broken thumbnail beats a
 *   broken booking screen. The 403 is then visible to the client, which is also a true statement
 *   about that object.
 * - **A URL that is already signed is returned untouched.** Signing a signed URL would fold the
 *   existing query string into the key and produce a URL that 403s for a brand new reason — the
 *   nastiest possible outcome, because it looks exactly like the bug this replaces.
 * - **Never persist what comes out of here.** `deleteFromS3` and the next signing both recover the
 *   key with `split(".amazonaws.com/")[1]`, so storing a signed URL breaks deletion permanently.
 */
export const signUrls = async (
  urls: string[] | undefined | null,
  expiresInSeconds: number
): Promise<string[]> => {
  if (!urls?.length) return [];
  return Promise.all(
    urls.map(async (url) => {
      if (typeof url !== "string" || !url) return url;
      if (url.includes("X-Amz-Signature=")) return url;
      try {
        return await getPresignedUrl(url, expiresInSeconds);
      } catch {
        return url;
      }
    })
  );
};

export const deleteFromS3 = async (fileUrl: string): Promise<void> => {
  const key = fileUrl.split(".amazonaws.com/")[1];
  if (!key) return;
  const command = new DeleteObjectCommand({
    Bucket: ENV.AWS_S3_BUCKET,
    Key: key,
  });
  await s3Client.send(command);
};