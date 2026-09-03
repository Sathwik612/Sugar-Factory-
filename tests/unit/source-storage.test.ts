import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import * as XLSX from "xlsx";

let storageRoot = "";
let readSourceFile: typeof import("../../artifacts/api-server/src/lib/sourceFileStorage.ts").readSourceFile;
let requestSourceUpload: typeof import("../../artifacts/api-server/src/lib/sourceFileStorage.ts").requestSourceUpload;
let storeSourceUpload: typeof import("../../artifacts/api-server/src/lib/sourceFileStorage.ts").storeSourceUpload;
let inspectWorkbook: typeof import("../../artifacts/api-server/src/lib/workbookImport.ts").inspectWorkbook;

test.before(async () => {
  process.env.NODE_ENV = "test";
  process.env.STORAGE_PROVIDER = "local";
  storageRoot = await mkdtemp(path.join(os.tmpdir(), "sugar-factory-storage-"));
  process.env.STORAGE_LOCAL_PATH = storageRoot;
  ({ readSourceFile, requestSourceUpload, storeSourceUpload } = await import(
    "../../artifacts/api-server/src/lib/sourceFileStorage.ts"
  ));
  ({ inspectWorkbook } = await import("../../artifacts/api-server/src/lib/workbookImport.ts"));
});

test.after(async () => {
  await rm(storageRoot, { recursive: true, force: true });
});

test("local storage round-trips a real Excel workbook through the canonical parser", async () => {
  const sheet = XLSX.utils.json_to_sheet([
    { Date: "2026-08-30", Shift: "A", "Cane Crushed": 1000, "Sugar Produced": 100 },
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Production");
  const bytes = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const upload = await requestSourceUpload("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  const uploadId = upload.objectPath.slice("local://uploads/".length);

  await storeSourceUpload(uploadId, bytes);
  const restored = await readSourceFile(upload.objectPath);
  assert.deepEqual(restored, bytes);
  assert.equal(inspectWorkbook(restored).rows.length, 1);
});

test("local object paths reject traversal and non-UUID identifiers", async () => {
  await assert.rejects(() => readSourceFile("local://uploads/../../etc/passwd"));
  await assert.rejects(() => storeSourceUpload("not-a-uuid", Buffer.from("bad")));
});