import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, mkdir, open, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

type StorageProviderName = "s3" | "local" | "replit";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";
const UPLOAD_ID_PATTERN = /^[a-f0-9-]{36}$/i;

function configuredProvider(): StorageProviderName {
  const configured = process.env.STORAGE_PROVIDER?.trim().toLowerCase();
  if (configured === "s3" || configured === "local" || configured === "replit") {
    return configured;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("STORAGE_PROVIDER is required in production. Set it to s3 or local.");
  }
  if (process.env.PRIVATE_OBJECT_DIR && process.env.REPL_ID) return "replit";
  return "local";
}

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required when STORAGE_PROVIDER=${configuredProvider()}.`);
  return value;
}

function localRoot() {
  const configured = process.env.STORAGE_LOCAL_PATH?.trim();
  if (process.env.NODE_ENV === "production" && (!configured || !path.isAbsolute(configured))) {
    throw new Error("STORAGE_LOCAL_PATH must be an absolute persistent path in production.");
  }
  return path.resolve(configured || ".data/uploads");
}

function s3Config() {
  return {
    bucket: required("S3_BUCKET"),
    region: process.env.S3_REGION?.trim() || "us-east-1",
    endpoint: process.env.S3_ENDPOINT?.trim() || undefined,
    accessKeyId: required("S3_ACCESS_KEY_ID"),
    secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
  };
}

function s3Client() {
  const config = s3Config();
  return {
    config,
    client: new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    }),
  };
}

function privateObjectDir() {
  const value = process.env.PRIVATE_OBJECT_DIR?.trim();
  if (!value) throw new Error("PRIVATE_OBJECT_DIR is not configured.");
  return value.replace(/\/+$/, "");
}

function parseReplitObjectPath(objectPath: string) {
  const normalized = objectPath.startsWith("/") ? objectPath : `/${objectPath}`;
  if (!normalized.startsWith("/objects/") || normalized.includes("..") || normalized.includes("\0")) {
    throw new Error("Invalid private object path.");
  }
  const entityId = normalized.slice("/objects/".length);
  const parts = privateObjectDir().replace(/^\/+/, "").split("/");
  const bucketName = parts.shift();
  if (!bucketName || !entityId) throw new Error("Invalid private object directory.");
  return { bucketName, objectName: [...parts, entityId].join("/") };
}

function parseLocalObjectPath(objectPath: string) {
  const prefix = "local://uploads/";
  if (!objectPath.startsWith(prefix)) throw new Error("Invalid local object path.");
  const uploadId = objectPath.slice(prefix.length);
  if (!UPLOAD_ID_PATTERN.test(uploadId)) throw new Error("Invalid local upload identifier.");
  const root = localRoot();
  const filePath = path.resolve(root, uploadId);
  if (!filePath.startsWith(`${root}${path.sep}`)) throw new Error("Invalid local object path.");
  return { uploadId, filePath };
}

function parseS3ObjectPath(objectPath: string) {
  if (!objectPath.startsWith("s3://")) throw new Error("Invalid S3 object path.");
  const withoutScheme = objectPath.slice("s3://".length);
  const separator = withoutScheme.indexOf("/");
  const bucket = separator > 0 ? withoutScheme.slice(0, separator) : "";
  const key = separator > 0 ? withoutScheme.slice(separator + 1) : "";
  const expectedBucket = required("S3_BUCKET");
  if (bucket !== expectedBucket || !key || key.includes("..") || key.includes("\0")) {
    throw new Error("Invalid S3 object path.");
  }
  return { bucket, key };
}

async function replitStorageClient() {
  const { Storage } = await import("@google-cloud/storage");
  return new Storage({
    credentials: {
      audience: "replit",
      subject_token_type: "access_token",
      token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
      type: "external_account",
      credential_source: {
        url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
        format: { type: "json", subject_token_field_name: "access_token" },
      },
      universe_domain: "googleapis.com",
    },
    projectId: "",
  });
}

async function signReplitObjectURL(bucketName: string, objectName: string, method: "PUT" | "GET") {
  const response = await fetch(`${REPLIT_SIDECAR_ENDPOINT}/object-storage/signed-object-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      bucket_name: bucketName,
      object_name: objectName,
      method,
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Failed to sign private object URL (${response.status}).`);
  const body = await response.json() as { signed_url?: string };
  if (!body.signed_url) throw new Error("Storage did not return a signed URL.");
  return body.signed_url;
}

export function validateStorageConfiguration() {
  const provider = configuredProvider();
  if (provider === "s3") s3Config();
  if (provider === "local") localRoot();
  if (provider === "replit") {
    if (process.env.NODE_ENV === "production") {
      throw new Error("STORAGE_PROVIDER=replit is not permitted in production.");
    }
    privateObjectDir();
  }
  return provider;
}

export function getStorageProvider() {
  return configuredProvider();
}

export async function requestSourceUpload(contentType = "application/octet-stream") {
  const provider = configuredProvider();
  const objectId = randomUUID();
  if (provider === "local") {
    return {
      uploadURL: `/api/storage/uploads/${objectId}`,
      objectPath: `local://uploads/${objectId}`,
    };
  }
  if (provider === "s3") {
    const { config, client } = s3Client();
    const key = `uploads/${objectId}`;
    return {
      uploadURL: await getSignedUrl(client, new PutObjectCommand({
        Bucket: config.bucket,
        Key: key,
        ContentType: contentType,
      }), { expiresIn: 15 * 60 }),
      objectPath: `s3://${config.bucket}/${key}`,
    };
  }
  const { bucketName, objectName } = parseReplitObjectPath(`/objects/uploads/${objectId}`);
  return {
    uploadURL: await signReplitObjectURL(bucketName, objectName, "PUT"),
    objectPath: `/objects/uploads/${objectId}`,
  };
}

export async function storeSourceUpload(uploadId: string, bytes: Buffer) {
  const objectPath = `local://uploads/${uploadId}`;
  const { filePath } = parseLocalObjectPath(objectPath);
  const root = localRoot();
  await mkdir(root, { recursive: true, mode: 0o700 });
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, bytes, { mode: 0o600, flag: "wx" });
    await link(temporaryPath, filePath);
    await unlink(temporaryPath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
  return objectPath;
}

export async function readSourceFile(objectPath: string) {
  const provider = configuredProvider();
  if (provider === "local") {
    const { filePath } = parseLocalObjectPath(objectPath);
    const file = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      return await file.readFile();
    } finally {
      await file.close();
    }
  }
  if (provider === "s3") {
    const { config, client } = s3Client();
    const { bucket, key } = parseS3ObjectPath(objectPath);
    const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    if (!response.Body) throw new Error("The stored workbook has no readable body.");
    return Buffer.from(await response.Body.transformToByteArray());
  }
  const { bucketName, objectName } = parseReplitObjectPath(objectPath);
  const [bytes] = await (await replitStorageClient()).bucket(bucketName).file(objectName).download();
  return bytes;
}