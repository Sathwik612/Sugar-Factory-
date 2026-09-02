import { sql } from "drizzle-orm";
import { boolean, date, index, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { usersTable } from "./auth";
import { factories } from "./factory";

export const factorySettings = pgTable("factory_settings", {
  id: uuid("id").defaultRandom().primaryKey(),
  factoryId: uuid("factory_id").notNull().references(() => factories.id),
  season: text("season").notNull().default("2025-26"),
  shiftConfig: jsonb("shift_config").notNull().default([]),
  kpiThresholds: jsonb("kpi_thresholds").notNull().default({}),
  targetDefaults: jsonb("target_defaults").notNull().default({}),
  updatedBy: text("updated_by").references(() => usersTable.id),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  factoryIdx: uniqueIndex("factory_settings_factory_idx").on(table.factoryId),
}));

export const kpiTargets = pgTable("kpi_targets", {
  id: uuid("id").defaultRandom().primaryKey(),
  factoryId: uuid("factory_id").notNull().references(() => factories.id),
  productionDate: date("production_date").notNull(),
  shift: text("shift").notNull().default("ALL"),
  code: text("code").notNull(),
  label: text("label").notNull(),
  target: numeric("target", { precision: 14, scale: 4 }).notNull(),
  unit: text("unit").notNull(),
  isDemo: boolean("is_demo").notNull().default(false),
  createdBy: text("created_by").references(() => usersTable.id),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  targetIdx: uniqueIndex("kpi_targets_factory_date_shift_code_idx").on(
    table.factoryId,
    table.productionDate,
    table.shift,
    table.code,
  ),
}));

export const operationalActions = pgTable("operational_actions", {
  id: uuid("id").defaultRandom().primaryKey(),
  factoryId: uuid("factory_id").notNull().references(() => factories.id),
  productionDate: date("production_date").notNull(),
  shift: text("shift").notNull().default("GENERAL"),
  department: text("department").notNull(),
  kind: text("kind").notNull().default("HANDOVER"),
  title: text("title").notNull(),
  detail: text("detail").notNull(),
  status: text("status").notNull().default("OPEN"),
  dueDate: date("due_date"),
  assignedTo: text("assigned_to"),
  createdBy: text("created_by").references(() => usersTable.id),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  isDemo: boolean("is_demo").notNull().default(false),
});

export const qualitySamples = pgTable("quality_samples", {
  id: uuid("id").defaultRandom().primaryKey(),
  factoryId: uuid("factory_id").notNull().references(() => factories.id),
  productionDate: date("production_date").notNull(),
  shift: text("shift").notNull().default("GENERAL"),
  sampleType: text("sample_type").notNull(),
  brix: numeric("brix", { precision: 8, scale: 3 }),
  pol: numeric("pol", { precision: 8, scale: 3 }),
  purity: numeric("purity", { precision: 8, scale: 3 }),
  status: text("status").notNull().default("PENDING"),
  notes: text("notes"),
  createdBy: text("created_by").references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  isDemo: boolean("is_demo").notNull().default(false),
});

export const storeMovements = pgTable("store_movements", {
  id: uuid("id").defaultRandom().primaryKey(),
  factoryId: uuid("factory_id").notNull().references(() => factories.id),
  productionDate: date("production_date").notNull(),
  material: text("material").notNull(),
  movementType: text("movement_type").notNull(),
  quantity: numeric("quantity", { precision: 14, scale: 4 }).notNull(),
  unit: text("unit").notNull(),
  reorderLevel: numeric("reorder_level", { precision: 14, scale: 4 }),
  notes: text("notes"),
  createdBy: text("created_by").references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  isDemo: boolean("is_demo").notNull().default(false),
});

export const maintenanceWorkOrders = pgTable("maintenance_work_orders", {
  id: uuid("id").defaultRandom().primaryKey(),
  factoryId: uuid("factory_id").notNull().references(() => factories.id),
  productionDate: date("production_date"),
  asset: text("asset").notNull(),
  issue: text("issue").notNull(),
  workType: text("work_type").notNull().default("BREAKDOWN"),
  priority: text("priority").notNull().default("MEDIUM"),
  status: text("status").notNull().default("OPEN"),
  hoursLost: numeric("hours_lost", { precision: 8, scale: 2 }),
  assignedTo: text("assigned_to"),
  createdBy: text("created_by").references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  isDemo: boolean("is_demo").notNull().default(false),
});

export const operationalAlerts = pgTable("operational_alerts", {
  id: uuid("id").defaultRandom().primaryKey(),
  factoryId: uuid("factory_id").notNull().references(() => factories.id),
  productionDate: date("production_date").notNull(),
  kpiCode: text("kpi_code").notNull(),
  severity: text("severity").notNull(),
  title: text("title").notNull(),
  detail: text("detail").notNull(),
  status: text("status").notNull().default("OPEN"),
  observedValue: numeric("observed_value", { precision: 14, scale: 4 }),
  threshold: numeric("threshold", { precision: 14, scale: 4 }),
  direction: text("direction"),
  sourceEntityType: text("source_entity_type"),
  sourceEntityId: text("source_entity_id"),
  acknowledgedBy: text("acknowledged_by").references(() => usersTable.id),
  acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
  resolvedBy: text("resolved_by").references(() => usersTable.id),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  isDemo: boolean("is_demo").notNull().default(false),
}, (table) => ({
  lookupIdx: index("operational_alerts_lookup_idx").on(
    table.factoryId,
    table.productionDate,
    table.kpiCode,
    table.status,
  ),
  oneActiveAlertIdx: uniqueIndex("operational_alerts_one_active_idx")
    .on(table.factoryId, table.productionDate, table.kpiCode)
    .where(sql`${table.status} in ('OPEN', 'ACKNOWLEDGED')`),
}));
