import assert from "node:assert/strict";
import { test } from "node:test";
import {
  calculateDailyOperationValues,
  calculateHoursLost,
  calculateKpiStatus,
  calculatePowerExported,
  calculatePowerKwhPerMtCane,
  calculateRecovery,
  calculateStoppageDuration,
  calculateTotalStoppageHours,
} from "../../artifacts/api-server/src/lib/kpi.ts";

test("calculates recovery from tonnes", () => {
  assert.equal(calculateRecovery(100, 1_000), 10);
  assert.equal(calculateRecovery(12.5, 125), 10);
});

test("fails safely for recovery with missing or invalid denominators", () => {
  assert.equal(calculateRecovery(100, 0), null);
  assert.equal(calculateRecovery(100, -1), null);
  assert.equal(calculateRecovery(null, 1_000), null);
  assert.equal(calculateRecovery(100, null), null);
});

test("calculates hours lost with a non-negative floor and fallback", () => {
  assert.equal(calculateHoursLost(24, 20), 4);
  assert.equal(calculateHoursLost(20, 24), 0);
  assert.equal(calculateHoursLost(null, null, 2.5), 2.5);
  assert.equal(calculateHoursLost(null, 20, null), null);
});

test("calculates stoppage durations and totals in hours", () => {
  assert.equal(calculateStoppageDuration("01:00", "02:30"), 1.5);
  assert.equal(calculateStoppageDuration("23:00", "01:00"), 2);
  assert.equal(calculateStoppageDuration("09:15", "09:15"), 0);
  assert.equal(calculateStoppageDuration("bad", "10:00"), null);
  assert.equal(
    calculateTotalStoppageHours([
      { durationHours: 1.5 },
      { durationHours: 0.75 },
      { durationHours: null },
    ]),
    2.25,
  );
  assert.equal(calculateTotalStoppageHours([]), 0);
});

test("calculates power export and normalized power use", () => {
  assert.equal(calculatePowerExported(5_000, 4_000), 1_000);
  assert.equal(calculatePowerExported(4_000, 5_000), 0);
  assert.equal(calculatePowerExported(null, 5_000), null);
  assert.equal(calculatePowerKwhPerMtCane(4_000, 1_000), 4);
  assert.equal(calculatePowerKwhPerMtCane(4_000, 0), null);
  assert.equal(calculatePowerKwhPerMtCane(null, null, 3.25), 3.25);
});

test("calculates all derived Daily Operations values without dropping source fields", () => {
  const result = calculateDailyOperationValues({
    production: { caneCrushed: 1_000, sugarProduced: 100, operatorNote: "checked" },
    timeAccount: { availableHours: 24, hoursWorked: 20 },
    energy: { powerGenerated: 5_000, powerUsed: 4_000, steamConsumption: 3.2 },
    efficiency: { plantEfficiency: 92 },
    stoppages: [
      { startTime: "01:00", endTime: "02:30", cause: "Mill" },
      { startTime: "10:00", endTime: "10:45", cause: "Boiler" },
    ],
  });

  assert.deepEqual(result.production, {
    caneCrushed: 1_000,
    sugarProduced: 100,
    operatorNote: "checked",
    recovery: 10,
  });
  assert.equal(result.timeAccount.hoursLost, 4);
  assert.equal(result.timeAccount.stoppageHours, 2.25);
  assert.equal(result.energy.powerExported, 1_000);
  assert.equal(result.efficiency.powerKwhPerMtCane, 4);
  assert.equal(result.stoppages[0].durationHours, 1.5);
});

test("applies direction-aware KPI status rules", () => {
  assert.equal(calculateKpiStatus("recovery", 9.5, { warning: 9.4, critical: 9.1, direction: "LOW" }), "GOOD");
  assert.equal(calculateKpiStatus("recovery", 9.3, { warning: 9.4, critical: 9.1, direction: "LOW" }), "WATCH");
  assert.equal(calculateKpiStatus("recovery", 9.0, { warning: 9.4, critical: 9.1, direction: "LOW" }), "CRITICAL");
  assert.equal(calculateKpiStatus("downtime", 9, { warning: 10, critical: 12, direction: "HIGH" }), "GOOD");
  assert.equal(calculateKpiStatus("downtime", 11, { warning: 10, critical: 12, direction: "HIGH" }), "WATCH");
  assert.equal(calculateKpiStatus("downtime", 13, { warning: 10, critical: 12, direction: "HIGH" }), "CRITICAL");
  assert.equal(calculateKpiStatus("recovery", null), "GOOD");
});