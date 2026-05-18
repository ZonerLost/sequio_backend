import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
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
    ACL: "public-read",
  });
  await s3Client.send(command);
  return `https://${ENV.AWS_S3_BUCKET}.s3.${ENV.AWS_REGION}.amazonaws.com/${key}`;
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