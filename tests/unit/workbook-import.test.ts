import assert from "node:assert/strict";
import { test } from "node:test";
import * as XLSX from "xlsx";
import { calculateImportedRow, inspectWorkbook } from "../../artifacts/api-server/src/lib/workbookImport.ts";

function workbookBuffer(rows: Record<string, unknown>[]) {
  const sheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Production");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

test("inspects an Excel workbook and maps Daily Operations columns", () => {
  const result = inspectWorkbook(workbookBuffer([
    { Date: "2026-08-30", Shift: "A", "Cane Crushed": 1000, "Sugar Produced": 100, "Power Used": 4000 },
  ]));
  assert.equal(result.issues.filter(issue => issue.severity === "ERROR").length, 0);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0]?.sourceLocation.sheet, "Production");
  assert.equal(result.mapping.caneCrushed, "Cane Crushed");
  assert.equal(calculateImportedRow(result.rows[0]!).production.recovery, 10);
});

test("rejects duplicate date and shift rows before import", () => {
  const result = inspectWorkbook(workbookBuffer([
    { Date: "2026-08-30", Shift: "A", "Cane Crushed": 1000, "Sugar Produced": 100 },
    { Date: "2026-08-30", Shift: "A", "Cane Crushed": 1100, "Sugar Produced": 110 },
  ]));
  assert.equal(result.rows.length, 1);
  assert.ok(result.issues.some(issue => issue.code === "DUPLICATE_WORKBOOK_ROW"));
});

test("rejects missing required columns and impossible production", () => {
  const missing = inspectWorkbook(workbookBuffer([{ Date: "2026-08-30", Shift: "A", "Cane Crushed": 1000 }]));
  assert.ok(missing.issues.some(issue => issue.code === "NO_DAILY_OPERATIONS_SHEET"));
  const impossible = inspectWorkbook(workbookBuffer([
    { Date: "2026-08-30", Shift: "A", "Cane Crushed": 0, "Sugar Produced": 10 },
  ]));
  assert.ok(impossible.issues.some(issue => issue.code === "IMPOSSIBLE_PRODUCTION"));
});