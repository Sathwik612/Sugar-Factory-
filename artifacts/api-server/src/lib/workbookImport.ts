import * as XLSX from "xlsx";
import { calculateDailyOperationValues, toFiniteNumber } from "./kpi";

export const WORKBOOK_PARSER_VERSION = "phase-1-sheetjs.1";
export const WORKBOOK_MAPPING_VERSION = "daily-operations-v1";

export type WorkbookSheetPreview = {
  name: string;
  headers: string[];
  rowCount: number;
  sampleRows: Record<string, unknown>[];
  candidate: boolean;
};

export type WorkbookIssue = {
  severity: "ERROR" | "WARNING";
  code: string;
  message: string;
  location: string;
  details?: Record<string, unknown>;
};

export type CanonicalWorkbookRow = {
  productionDate: string;
  shift: string;
  season: string;
  production: Record<string, unknown>;
  quality: Record<string, unknown>;
  efficiency: Record<string, unknown>;
  timeAccount: Record<string, unknown>;
  energy: Record<string, unknown>;
  stoppages: Record<string, unknown>[];
  materials: unknown[];
  sourceLocation: {
    sheet: string;
    row: number;
  };
};

export type WorkbookInspection = {
  sheets: WorkbookSheetPreview[];
  rows: CanonicalWorkbookRow[];
  issues: WorkbookIssue[];
  mapping: Record<string, string>;
};

const aliases: Record<string, string[]> = {
  productionDate: ["productiondate", "date", "productionday", "day"],
  shift: ["shift", "shiftname"],
  season: ["season", "seasonyear"],
  caneCrushed: ["canecrushed", "canecrush", "canecrushing", "canecrushedmt", "canetonnage"],
  sugarProduced: ["sugarproduced", "sugarproduction", "sugaroutput", "sugartonnage"],
  availableHours: ["availablehours", "availabletime", "scheduledhours"],
  hoursWorked: ["hoursworked", "operatinghours", "workedhours"],
  hoursLost: ["hourslost", "losthours", "downtime", "downtimehours"],
  powerGenerated: ["powergenerated", "generation", "powergeneration", "generatedpower"],
  powerUsed: ["powerused", "powerconsumed", "consumptionpower"],
  steamConsumption: ["steamconsumption", "steamused", "steampertonnecane", "steamtcane"],
  powerKwhPerMtCane: ["powerkwhpermtcane", "powerpertonnecane", "powerkwhpertonnecane"],
};

function normalizeHeader(value: unknown) {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function excelDate(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) {
      return `${String(parsed.y).padStart(4, "0")}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
    }
  }
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function numeric(value: unknown) {
  return toFiniteNumber(typeof value === "string" ? value.replaceAll(",", "") : value);
}

function findColumn(headers: string[], field: string) {
  const accepted = aliases[field] ?? [];
  return headers.find((header) => accepted.includes(normalizeHeader(header))) ?? null;
}

function readRows(sheet: XLSX.WorkSheet) {
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: null,
    raw: true,
  });
}

function makePreview(name: string, rows: Record<string, unknown>[]): WorkbookSheetPreview {
  const headers = rows.length ? Object.keys(rows[0]) : [];
  const normalized = headers.map(normalizeHeader);
  const candidate = ["productionDate", "caneCrushed", "sugarProduced"].every((field) =>
    normalized.some((header) => (aliases[field] ?? []).includes(header)),
  );
  return {
    name,
    headers,
    rowCount: rows.length,
    sampleRows: rows.slice(0, 5),
    candidate,
  };
}

function buildMapping(headers: string[]) {
  const mapping: Record<string, string> = {};
  for (const field of Object.keys(aliases)) {
    const column = findColumn(headers, field);
    if (column) mapping[field] = column;
  }
  return mapping;
}

function value(row: Record<string, unknown>, mapping: Record<string, string>, field: string) {
  return mapping[field] ? row[mapping[field]] : null;
}

export function inspectWorkbook(bytes: Buffer): WorkbookInspection {
  const workbook = XLSX.read(bytes, { type: "buffer", cellDates: true, dense: true });
  const previews: WorkbookSheetPreview[] = [];
  const issues: WorkbookIssue[] = [];
  const rows: CanonicalWorkbookRow[] = [];
  let selectedMapping: Record<string, string> = {};
  const rowKeys = new Set<string>();

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rawRows = readRows(sheet);
    const preview = makePreview(sheetName, rawRows);
    previews.push(preview);
    if (!preview.candidate) continue;
    if (Object.keys(selectedMapping).length) {
      issues.push({
        severity: "WARNING",
        code: "MULTIPLE_CANDIDATE_SHEETS",
        message: `Sheet "${sheetName}" also resembles a Daily Operations sheet; the first candidate sheet will be used.`,
        location: `sheet:${sheetName}`,
      });
      continue;
    }

    selectedMapping = buildMapping(preview.headers);
    const required = ["productionDate", "caneCrushed", "sugarProduced"];
    for (const field of required) {
      if (!selectedMapping[field]) {
        issues.push({
          severity: "ERROR",
          code: "REQUIRED_COLUMN_MISSING",
          message: `Required column for ${field} was not detected.`,
          location: `sheet:${sheetName}`,
          details: { field, headers: preview.headers },
        });
      }
    }

    rawRows.forEach((rawRow, index) => {
      const sourceRow = index + 2;
      const productionDate = excelDate(value(rawRow, selectedMapping, "productionDate"));
      const caneCrushed = numeric(value(rawRow, selectedMapping, "caneCrushed"));
      const sugarProduced = numeric(value(rawRow, selectedMapping, "sugarProduced"));
      const rowLocation = `sheet:${sheetName},row:${sourceRow}`;

      if (!productionDate) {
        issues.push({
          severity: "ERROR",
          code: "INVALID_DATE",
          message: "Expected a valid production date.",
          location: rowLocation,
        });
      }
      if (caneCrushed === null) {
        issues.push({
          severity: "ERROR",
          code: "INVALID_CANE_CRUSHED",
          message: "Expected a numeric cane crushed value.",
          location: `${rowLocation},column:${selectedMapping.caneCrushed ?? "unknown"}`,
        });
      } else if (caneCrushed < 0) {
        issues.push({
          severity: "ERROR",
          code: "NEGATIVE_CANE_CRUSHED",
          message: "Cane crushed cannot be negative.",
          location: rowLocation,
        });
      }
      if (sugarProduced === null) {
        issues.push({
          severity: "ERROR",
          code: "INVALID_SUGAR_PRODUCED",
          message: "Expected a numeric sugar produced value.",
          location: `${rowLocation},column:${selectedMapping.sugarProduced ?? "unknown"}`,
        });
      } else if (sugarProduced < 0) {
        issues.push({
          severity: "ERROR",
          code: "NEGATIVE_SUGAR_PRODUCED",
          message: "Sugar produced cannot be negative.",
          location: rowLocation,
        });
      }
      if (!productionDate || caneCrushed === null || sugarProduced === null) return;
      if (caneCrushed === 0 && sugarProduced > 0) {
        issues.push({
          severity: "ERROR",
          code: "IMPOSSIBLE_PRODUCTION",
          message: "Sugar produced cannot be positive when cane crushed is zero.",
          location: rowLocation,
        });
        return;
      }
      const rowKey = `${productionDate}|${String(value(rawRow, selectedMapping, "shift") ?? "GENERAL").trim() || "GENERAL"}`;
      if (rowKeys.has(rowKey)) {
        issues.push({
          severity: "ERROR",
          code: "DUPLICATE_WORKBOOK_ROW",
          message: "The workbook contains more than one row for the same production date and shift.",
          location: rowLocation,
          details: { key: rowKey },
        });
        return;
      }
      rowKeys.add(rowKey);

      rows.push({
        productionDate,
        shift: String(value(rawRow, selectedMapping, "shift") ?? "GENERAL").trim() || "GENERAL",
        season: String(value(rawRow, selectedMapping, "season") ?? "2025-26").trim() || "2025-26",
        production: { caneCrushed, sugarProduced },
        quality: {},
        efficiency: {
          powerKwhPerMtCane: numeric(value(rawRow, selectedMapping, "powerKwhPerMtCane")),
        },
        timeAccount: {
          availableHours: numeric(value(rawRow, selectedMapping, "availableHours")),
          hoursWorked: numeric(value(rawRow, selectedMapping, "hoursWorked")),
          hoursLost: numeric(value(rawRow, selectedMapping, "hoursLost")),
        },
        energy: {
          powerGenerated: numeric(value(rawRow, selectedMapping, "powerGenerated")),
          powerUsed: numeric(value(rawRow, selectedMapping, "powerUsed")),
          steamConsumption: numeric(value(rawRow, selectedMapping, "steamConsumption")),
        },
        stoppages: [],
        materials: [],
        sourceLocation: { sheet: sheetName, row: sourceRow },
      });
    });
  }

  if (!previews.length) {
    issues.push({
      severity: "ERROR",
      code: "EMPTY_WORKBOOK",
      message: "The workbook does not contain any sheets.",
      location: "workbook",
    });
  }
  if (!selectedMapping || !Object.keys(selectedMapping).length) {
    issues.push({
      severity: "ERROR",
      code: "NO_DAILY_OPERATIONS_SHEET",
      message: "No sheet with the required Daily Operations columns was detected.",
      location: "workbook",
    });
  }

  return {
    sheets: previews,
    rows,
    issues,
    mapping: selectedMapping,
  };
}

export function calculateImportedRow(row: CanonicalWorkbookRow): CanonicalWorkbookRow {
  const calculated = calculateDailyOperationValues({
    production: row.production,
    timeAccount: row.timeAccount,
    energy: row.energy,
    efficiency: row.efficiency,
    stoppages: row.stoppages,
  });
  return {
    ...row,
    production: calculated.production,
    quality: row.quality,
    efficiency: calculated.efficiency,
    timeAccount: calculated.timeAccount,
    energy: calculated.energy,
    stoppages: calculated.stoppages,
  } as CanonicalWorkbookRow;
}