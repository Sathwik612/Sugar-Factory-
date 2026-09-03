import { randomUUID } from "node:crypto";
import { Storage } from "@google-cloud/storage";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

const objectStorageClient = new Storage({
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

function privateObjectDir() {
  const value = process.env.PRIVATE_OBJECT_DIR?.trim();
  if (!value) throw new Error("PRIVATE_OBJECT_DIR is not configured.");
  return value.replace(/\/+$/, "");
}

function parseObjectPath(path: string) {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  if (!normalized.startsWith("/objects/") || normalized.includes("..") || normalized.includes("\0")) {
    throw new Error("Invalid private object path.");
  }
  const entityId = normalized.slice("/objects/".length);
  const parts = privateObjectDir().replace(/^\/+/, "").split("/");
  const bucketName = parts.shift();
  if (!bucketName || !entityId) throw new Error("Invalid private object directory.");
  return { bucketName, objectName: [...parts, entityId].join("/") };
}

async function signObjectURL(bucketName: string, objectName: string, method: "PUT" | "GET") {
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

export async function requestSourceUpload() {
  const objectId = randomUUID();
  const { bucketName, objectName } = parseObjectPath(`/objects/uploads/${objectId}`);
  return {
    uploadURL: await signObjectURL(bucketName, objectName, "PUT"),
    objectPath: `/objects/uploads/${objectId}`,
  };
}

export async function readSourceFile(objectPath: string) {
  const { bucketName, objectName } = parseObjectPath(objectPath);
  const [bytes] = await objectStorageClient.bucket(bucketName).file(objectName).download();
  return bytes;
}