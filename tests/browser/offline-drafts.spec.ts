import { expect, test, type Page } from "@playwright/test";

function uniqueDate(offsetDays: number) {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

async function login(page: Page, username = "production") {
  await page.goto("/");
  await page.getByTestId("input-login-username").fill(username);
  await page.getByTestId("input-login-password").fill("demo123");
  await page.getByTestId("button-login").click();
  await expect(page.getByTestId("button-logout")).toBeVisible();
  await page.goto("/daily-operations");
  await expect(page.getByRole("heading", { name: "Daily operations" })).toBeVisible();
}

async function selectDate(page: Page, date: string) {
  const responsePromise = page.waitForResponse((response) =>
    response.request().method() === "GET" &&
    response.url().endsWith(`/api/daily-operations/${date}`),
  );
  const loading = page.getByRole("status").filter({ hasText: "Loading the server record" });
  await page.getByLabel("Production date").fill(date);
  await expect(page.getByLabel("Production date")).toHaveValue(date);
  const response = await responsePromise;
  expect(response.ok(), `loading ${date} failed with ${response.status()}`).toBe(true);
  await expect(loading).toBeHidden();
  await expect(page.getByLabel("Cane crushed · t")).toBeVisible();
}

async function getServerRecord(page: Page, productionDate: string) {
  const result = await page.evaluate(async (date) => {
    const response = await fetch(`/api/daily-operations/${date}`, { credentials: "include" });
    return { status: response.status, body: await response.json() };
  }, productionDate);
  expect(result.status).toBe(200);
  return result.body;
}

async function updateServerDraft(page: Page, productionDate: string, updatedAt: string, cane: number, sugar: number) {
  const result = await page.evaluate(async ({ date, expectedUpdatedAt, caneCrushed, sugarProduced }) => {
    const response = await fetch("/api/daily-operations", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        productionDate: date,
        shift: "GENERAL",
        status: "DRAFT",
        expectedUpdatedAt,
        production: { caneCrushed, sugarProduced },
        quality: {},
        efficiency: {},
        timeAccount: {},
        energy: {},
        stoppages: [],
        materials: [],
      }),
    });
    return { status: response.status, body: await response.json() };
  }, { date: productionDate, expectedUpdatedAt: updatedAt, caneCrushed: cane, sugarProduced: sugar });
  expect(result.status).toBe(200);
  expect(String(result.body.production.caneCrushed)).toBe(String(cane));
  expect(result.body.updatedAt).not.toBe(updatedAt);
  return result.body;
}

async function saveLocalDraft(page: Page, cane: string, sugar: string) {
  await page.getByLabel("Cane crushed · t").fill(cane);
  await page.getByLabel("Sugar produced · t").fill(sugar);
  await page.getByRole("button", { name: "Save on device" }).click();
  await expect(page.getByText("Draft saved on this device. It is pending synchronization.")).toBeVisible();
}

test("saves offline work and keeps an offline submit local", async ({ page }) => {
  await login(page, "admin");
  await selectDate(page, uniqueDate(10));
  await page.context().setOffline(true);
  await expect(page.getByText("Offline — drafts can be saved on this device.")).toBeVisible();

  await saveLocalDraft(page, "1234", "120");
  await page.getByRole("button", { name: "Keep pending" }).click();
  await expect(page.getByText(/remains a local draft and will not be submitted/i)).toBeVisible();

  const storedDraft = await page.evaluate(() => new Promise<boolean>((resolve, reject) => {
    const request = indexedDB.open("sugar-factory-offline", 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const read = request.result.transaction("daily-operation-drafts").objectStore("daily-operation-drafts").getAll();
      read.onsuccess = () => resolve(read.result.some((draft: { state: string; payload: { production: { caneCrushed: string } } }) => draft.state === "SYNC_PENDING" && String(draft.payload.production.caneCrushed) === "1234"));
      read.onerror = () => reject(read.error);
    };
  }));
  expect(storedDraft).toBe(true);
});

test("reconnects, synchronizes, and exposes both conflict choices", async ({ page }) => {
  await login(page, "manager");
  const date = uniqueDate(11);
  await selectDate(page, date);
  await page.getByLabel("Cane crushed · t").fill("1000");
  await page.getByLabel("Sugar produced · t").fill("100");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText(/Draft saved\. It is not included/i)).toBeVisible();

  await page.context().setOffline(true);
  await page.getByLabel("Cane crushed · t").fill("1100");
  await saveLocalDraft(page, "1100", "110");
  await page.context().setOffline(false);
  await expect(page.getByText(/Connection restored/i)).toBeVisible();
  await page.getByRole("button", { name: "Sync current draft" }).click();
  await expect(page.getByText("Sync: synced")).toBeVisible();

  const serverRecord = await getServerRecord(page, date);
  expect(String(serverRecord.production.caneCrushed)).toBe("1100");

  const conflictDate = uniqueDate(12);
  await selectDate(page, conflictDate);
  await page.getByLabel("Cane crushed · t").fill("2000");
  await page.getByLabel("Sugar produced · t").fill("200");
  await page.getByRole("button", { name: "Save draft" }).click();
  const original = await getServerRecord(page, conflictDate);
  await page.context().setOffline(true);
  await saveLocalDraft(page, "2100", "210");
  await page.context().setOffline(false);
  const conflictServer = await updateServerDraft(page, conflictDate, original.updatedAt, 2200, 220);
  const verifiedConflictServer = await getServerRecord(page, conflictDate);
  expect(String(verifiedConflictServer.production.caneCrushed)).toBe("2200");
  expect(verifiedConflictServer.updatedAt).toBe(conflictServer.updatedAt);
  await selectDate(page, uniqueDate(20));
  await selectDate(page, conflictDate);
  await expect(page.getByText("Draft conflict needs review")).toBeVisible();
  await page.getByRole("button", { name: "Use server version" }).click();
  await expect(page.getByText("The server version is now loaded.")).toBeVisible();

  const keepDate = uniqueDate(13);
  await selectDate(page, keepDate);
  await page.getByLabel("Cane crushed · t").fill("3000");
  await page.getByLabel("Sugar produced · t").fill("300");
  await page.getByRole("button", { name: "Save draft" }).click();
  const keepOriginal = await getServerRecord(page, keepDate);
  await page.context().setOffline(true);
  await saveLocalDraft(page, "3100", "310");
  await page.context().setOffline(false);
  const keepServer = await updateServerDraft(page, keepDate, keepOriginal.updatedAt, 3200, 320);
  const verifiedKeepServer = await getServerRecord(page, keepDate);
  expect(String(verifiedKeepServer.production.caneCrushed)).toBe("3200");
  expect(verifiedKeepServer.updatedAt).toBe(keepServer.updatedAt);
  await selectDate(page, uniqueDate(21));
  await selectDate(page, keepDate);
  await expect(page.getByText("Draft conflict needs review")).toBeVisible();
  await page.getByRole("button", { name: "Keep local values" }).click();
  await expect(page.getByText("Local values kept. Sync again to replace the server draft.")).toBeVisible();
  await expect(page.getByLabel("Cane crushed · t")).toHaveValue("3100");
});