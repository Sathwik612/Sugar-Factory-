import assert from "node:assert/strict";
import { test } from "node:test";
import { checkReadiness } from "../../artifacts/api-server/src/routes/health.ts";
import { db, dailyOperations } from "@workspace/db";
import { eq } from "drizzle-orm";

type CookieJar = { value: string };

const baseUrl = process.env.TEST_API_URL;
if (!baseUrl) throw new Error("TEST_API_URL is required.");

async function request(path: string, init: RequestInit = {}, jar?: CookieJar) {
  const headers = new Headers(init.headers);
  if (jar?.value) headers.set("cookie", jar.value);
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers });
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  if (cookie && jar) jar.value = cookie;
  return response;
}

async function json(response: Response) {
  return (await response.json()) as Record<string, any>;
}

async function login(username: string) {
  const jar: CookieJar = { value: "" };
  const response = await request("/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password: "demo123" }),
  }, jar);
  assert.equal(response.status, 200, `login failed for ${username}`);
  return jar;
}

function recordBody(productionDate: string, shift: string) {
  return {
    productionDate,
    shift,
    season: "2025-26",
    status: "SUBMITTED",
    priority: "HIGH",
    production: { caneCrushed: 100, sugarProduced: 10 },
    quality: {},
    efficiency: {},
    timeAccount: { availableHours: 24, hoursWorked: 20 },
    energy: {},
    stoppages: [],
    materials: [],
  };
}

test("protects approvals, readiness, rate limits, and push subscriptions", async () => {
  assert.equal(
    await checkReadiness(() => Promise.reject(new Error("database unavailable")), 25),
    false,
    "a failed database probe must report not ready",
  );

  const manager = await login("manager");
  const admin = await login("admin");
  const productionDate = new Date(Date.now() + 366 * 86_400_000).toISOString().slice(0, 10);
  const shift = `TEST-${Date.now()}`;

  const submittedResponse = await request("/daily-operations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(recordBody(productionDate, shift)),
  }, manager);
  assert.equal(submittedResponse.status, 200);
  const submitted = await json(submittedResponse);
  assert.ok(submitted.id);

  // MANAGEMENT normally routes to ADMIN review. Pin this fixture to MANAGER so
  // the API reaches the explicit submitter/reviewer guard.
  await db
    .update(dailyOperations)
    .set({ reviewerRole: "MANAGER" })
    .where(eq(dailyOperations.id, submitted.id));

  const selfApproval = await request(`/approval-queue/${submitted.id}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "APPROVE" }),
  }, manager);
  assert.equal(selfApproval.status, 403);
  assert.match((await json(selfApproval)).error, /submitter cannot approve/i);

  const approvedResponse = await request(`/approval-queue/${submitted.id}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "APPROVE" }),
  }, admin);
  assert.equal(approvedResponse.status, 200);
  const approved = await json(approvedResponse);

  const lockedEdit = await request("/daily-operations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...recordBody(productionDate, shift), status: "DRAFT", expectedUpdatedAt: approved.updatedAt }),
  }, manager);
  assert.equal(lockedEdit.status, 409);
  assert.match((await json(lockedEdit)).error, /approved records are locked/i);

  const endpoint = `https://fcm.googleapis.com/fcm/send/subscription-${Date.now()}`;
  const subscribed = await request("/push-subscriptions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ endpoint, keys: { p256dh: "test-public-key", auth: "test-auth" } }),
  }, manager);
  assert.equal(subscribed.status, 201);
  const subscription = await json(subscribed);
  assert.ok(subscription.id);

  const revoked = await request(`/push-subscriptions/${subscription.id}`, { method: "DELETE" }, manager);
  assert.equal(revoked.status, 204);
  const subscriptions = await request("/push-subscriptions", {}, manager);
  assert.equal(subscriptions.status, 200);
  const rows = (await subscriptions.json()) as Array<{ id: string; revokedAt: string | null }>;
  assert.ok(rows.some((row) => row.id === subscription.id && row.revokedAt), "revoked subscription remains auditable");

  const rateLimitUsername = `rate-limit-${Date.now()}`;
  let rateLimited: Response | undefined;
  for (let attempt = 0; attempt < 11; attempt += 1) {
    rateLimited = await request("/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: rateLimitUsername, password: "wrong" }),
    });
  }
  assert.equal(rateLimited?.status, 429);
  assert.match((await json(rateLimited!)).error, /too many requests/i);
});