import {
  boolean,
  date,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { usersTable } from "./auth";

export const factories = pgTable("factories", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  timezone: text("timezone").notNull().default("Asia/Kolkata"),
  isDemo: boolean("is_demo").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const productionDays = pgTable(
  "production_days",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    factoryId: uuid("factory_id").notNull().references(() => factories.id),
    productionDate: date("production_date").notNull(),
    dataStatus: text("data_status").notNull().default("PARTIAL"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    factoryDateIdx: uniqueIndex("production_days_factory_date_idx").on(
      table.factoryId,
      table.productionDate,
    ),
  }),
);

export const sourceFiles = pgTable("source_files", {
  id: uuid("id").defaultRandom().primaryKey(),
  factoryId: uuid("factory_id").notNull().references(() => factories.id),
  filename: text("filename").notNull(),
  reportType: text("report_type").notNull(),
  reportingDate: date("reporting_date"),
  status: text("status").notNull(),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).defaultNow().notNull(),
  sizeBytes: integer("size_bytes").notNull().default(0),
  sha256: text("sha256").notNull(),
  synthetic: boolean("synthetic").notNull().default(false),
  issueCount: integer("issue_count").notNull().default(0),
});

export const kpiValues = pgTable(
  "kpi_values",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    factoryId: uuid("factory_id").notNull().references(() => factories.id),
    productionDayId: uuid("production_day_id").notNull().references(() => productionDays.id),
    code: text("code").notNull(),
    label: text("label").notNull(),
    value: numeric("value", { precision: 14, scale: 4 }),
    unit: text("unit").notNull(),
    status: text("status").notNull(),
    comparisonLabel: text("comparison_label").notNull(),
    comparisonValue: numeric("comparison_value", { precision: 14, scale: 4 }),
    sourceCount: integer("source_count").notNull().default(0),
  },
  (table) => ({
    dayKpiIdx: uniqueIndex("kpi_values_day_code_idx").on(table.productionDayId, table.code),
  }),
);

export const anomalies = pgTable("anomalies", {
  id: uuid("id").defaultRandom().primaryKey(),
  factoryId: uuid("factory_id").notNull().references(() => factories.id),
  productionDayId: uuid("production_day_id").notNull().references(() => productionDays.id),
  kpiCode: text("kpi_code").notNull(),
  severity: text("severity").notNull(),
  title: text("title").notNull(),
  detail: text("detail").notNull(),
  acknowledged: boolean("acknowledged").notNull().default(false),
});

export const trendPoints = pgTable("trend_points", {
  id: uuid("id").defaultRandom().primaryKey(),
  factoryId: uuid("factory_id").notNull().references(() => factories.id),
  productionDate: date("production_date").notNull(),
  recovery: numeric("recovery", { precision: 10, scale: 4 }),
  caneCrushed: numeric("cane_crushed", { precision: 14, scale: 4 }),
  downtime: numeric("downtime", { precision: 10, scale: 4 }),
});

export const lineageReferences = pgTable("lineage_references", {
  id: uuid("id").defaultRandom().primaryKey(),
  factoryId: uuid("factory_id").notNull().references(() => factories.id),
  productionDayId: uuid("production_day_id").notNull().references(() => productionDays.id),
  kpiCode: text("kpi_code").notNull(),
  canonicalField: text("canonical_field").notNull(),
  fileId: uuid("file_id").notNull().references(() => sourceFiles.id),
  sheet: text("sheet").notNull(),
  sourceRow: integer("source_row").notNull(),
  sourceColumn: text("source_column").notNull(),
  rawValue: text("raw_value").notNull(),
  formula: text("formula").notNull(),
});

export const processingEvents = pgTable("processing_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  sourceFileId: uuid("source_file_id").notNull().references(() => sourceFiles.id),
  status: text("status").notNull(),
  at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
  note: text("note"),
});

export const validationIssues = pgTable("validation_issues", {
  id: uuid("id").defaultRandom().primaryKey(),
  sourceFileId: uuid("source_file_id").notNull().references(() => sourceFiles.id),
  severity: text("severity").notNull(),
  code: text("code").notNull(),
  message: text("message").notNull(),
  location: text("location"),
  details: jsonb("details"),
});

export const dailyOperations = pgTable(
  "daily_operations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    factoryId: uuid("factory_id").notNull().references(() => factories.id),
    productionDate: date("production_date").notNull(),
    season: text("season").notNull(),
    shift: text("shift").notNull(),
    status: text("status").notNull().default("DRAFT"),
    source: text("source").notNull().default("MANUAL_ENTRY"),
    submittedBy: varchar("submitted_by").references(() => usersTable.id),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    production: jsonb("production").notNull().default({}),
    quality: jsonb("quality").notNull().default({}),
    efficiency: jsonb("efficiency").notNull().default({}),
    timeAccount: jsonb("time_account").notNull().default({}),
    stoppages: jsonb("stoppages").notNull().default([]),
    energy: jsonb("energy").notNull().default({}),
    materials: jsonb("materials").notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    factoryDateShiftIdx: uniqueIndex("daily_operations_factory_date_shift_idx").on(
      table.factoryId,
      table.productionDate,
      table.shift,
    ),
  }),
);