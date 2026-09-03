/**
 * Canonical KPI definitions and deterministic Daily Operations calculations.
 *
 * Keep business formulas in this module. Route handlers should validate input,
 * call these named functions, and persist the returned values; they should not
 * contain a second copy of a formula.
 */

export type KpiCode =
  | "cane_crushed"
  | "sugar_produced"
  | "recovery"
  | "downtime"
  | "hours_lost"
  | "stoppage_hours"
  | "power_generated"
  | "power_used"
  | "power_exported"
  | "power_kwh_per_mt_cane"
  | "steam_consumption";

export type KpiDefinition = {
  code: KpiCode;
  label: string;
  purpose: string;
  formula: string;
  inputs: string[];
  unit: string;
  configurable: boolean;
};

export const KPI_DEFINITIONS: readonly KpiDefinition[] = [
  {
    code: "cane_crushed",
    label: "Cane Crushed",
    purpose: "Measures the quantity of cane processed during the operating period.",
    formula: "Source value; no derived formula.",
    inputs: ["production.caneCrushed"],
    unit: "t",
    configurable: false,
  },
  {
    code: "sugar_produced",
    label: "Sugar Produced",
    purpose: "Measures sugar output during the operating period.",
    formula: "Source value; no derived formula.",
    inputs: ["production.sugarProduced"],
    unit: "t",
    configurable: false,
  },
  {
    code: "recovery",
    label: "Recovery",
    purpose: "Measures sugar produced as a percentage of cane crushed.",
    formula: "(Sugar Produced / Cane Crushed) × 100",
    inputs: ["production.sugarProduced", "production.caneCrushed"],
    unit: "%",
    configurable: false,
  },
  {
    code: "hours_lost",
    label: "Hours Lost",
    purpose: "Measures operating time unavailable within the declared time account.",
    formula: "max(0, Available Hours − Hours Worked)",
    inputs: ["timeAccount.availableHours", "timeAccount.hoursWorked"],
    unit: "h",
    configurable: false,
  },
  {
    code: "downtime",
    label: "Downtime",
    purpose: "The management KPI currently backed by the Hours Lost value.",
    formula: "Hours Lost",
    inputs: ["timeAccount.availableHours", "timeAccount.hoursWorked"],
    unit: "h",
    configurable: false,
  },
  {
    code: "stoppage_hours",
    label: "Stoppage Hours",
    purpose: "Aggregates the duration of all valid stoppage entries.",
    formula: "Σ(End Time − Start Time), expressed in hours",
    inputs: ["stoppages[].startTime", "stoppages[].endTime"],
    unit: "h",
    configurable: false,
  },
  {
    code: "power_generated",
    label: "Power Generated",
    purpose: "Measures gross power generation during the operating period.",
    formula: "Source value; no derived formula.",
    inputs: ["energy.powerGenerated"],
    unit: "kWh",
    configurable: false,
  },
  {
    code: "power_used",
    label: "Power Used",
    purpose: "Measures power consumed by the factory.",
    formula: "Source value; no derived formula.",
    inputs: ["energy.powerUsed"],
    unit: "kWh",
    configurable: false,
  },
  {
    code: "power_exported",
    label: "Power Exported",
    purpose: "Measures non-negative power available for export after factory use.",
    formula: "max(0, Power Generated − Power Used)",
    inputs: ["energy.powerGenerated", "energy.powerUsed"],
    unit: "kWh",
    configurable: false,
  },
  {
    code: "power_kwh_per_mt_cane",
    label: "Power per Tonne Cane",
    purpose: "Normalizes factory power use against cane crushed.",
    formula: "Power Used / Cane Crushed",
    inputs: ["energy.powerUsed", "production.caneCrushed"],
    unit: "kWh/t cane",
    configurable: false,
  },
  {
    code: "steam_consumption",
    label: "Steam Consumption",
    purpose: "Measures normalized steam consumption supplied by the energy section.",
    formula: "Source value; retained/normalized from energy.steamConsumption.",
    inputs: ["energy.steamConsumption"],
    unit: "t/t cane",
    configurable: false,
  },
] as const;

export const DEFAULT_KPI_THRESHOLDS = {
  recovery: { warning: 9.4, critical: 9.1, direction: "LOW" },
  downtime: { warning: 10, critical: 12, direction: "HIGH" },
} as const;

export function toFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function calculateRecovery(
  sugarProduced: number | null,
  caneCrushed: number | null,
): number | null {
  if (
    sugarProduced === null ||
    caneCrushed === null ||
    caneCrushed <= 0
  ) {
    return null;
  }
  return (sugarProduced / caneCrushed) * 100;
}

export function calculateHoursLost(
  availableHours: number | null,
  hoursWorked: number | null,
  suppliedHoursLost: number | null = null,
): number | null {
  if (availableHours !== null && hoursWorked !== null) {
    return Math.max(0, availableHours - hoursWorked);
  }
  return suppliedHoursLost;
}

export function calculateStoppageDuration(
  startTime: string,
  endTime: string,
): number | null {
  const [startHours, startMinutes] = startTime.split(":").map(Number);
  const [endHours, endMinutes] = endTime.split(":").map(Number);
  if (
    ![startHours, startMinutes, endHours, endMinutes].every(Number.isFinite) ||
    startHours < 0 ||
    startHours > 23 ||
    endHours < 0 ||
    endHours > 23 ||
    startMinutes < 0 ||
    startMinutes > 59 ||
    endMinutes < 0 ||
    endMinutes > 59
  ) {
    return null;
  }

  let minutes = (endHours * 60 + endMinutes) - (startHours * 60 + startMinutes);
  if (minutes < 0) minutes += 24 * 60;
  return minutes / 60;
}

export function calculateTotalStoppageHours(
  stoppages: readonly Record<string, unknown>[],
): number {
  return stoppages.reduce((total, item) => {
    const duration = toFiniteNumber(item.durationHours);
    return total + (duration ?? 0);
  }, 0);
}

export function calculatePowerExported(
  powerGenerated: number | null,
  powerUsed: number | null,
): number | null {
  if (powerGenerated === null || powerUsed === null) return null;
  return Math.max(0, powerGenerated - powerUsed);
}

export function calculatePowerKwhPerMtCane(
  powerUsed: number | null,
  caneCrushed: number | null,
  suppliedValue: number | null = null,
): number | null {
  if (powerUsed !== null && caneCrushed !== null && caneCrushed > 0) {
    return powerUsed / caneCrushed;
  }
  return suppliedValue;
}

export type DailyOperationCalculationInput = {
  production: Record<string, unknown>;
  timeAccount: Record<string, unknown>;
  energy: Record<string, unknown>;
  efficiency: Record<string, unknown>;
  stoppages: readonly Record<string, unknown>[];
};

export function calculateDailyOperationValues(input: DailyOperationCalculationInput) {
  const caneCrushed = toFiniteNumber(input.production.caneCrushed);
  const sugarProduced = toFiniteNumber(input.production.sugarProduced);
  const availableHours = toFiniteNumber(input.timeAccount.availableHours);
  const hoursWorked = toFiniteNumber(input.timeAccount.hoursWorked);
  const powerGenerated = toFiniteNumber(
    input.energy.powerGenerated ?? input.production.powerGenerated,
  );
  const powerUsed = toFiniteNumber(input.energy.powerUsed);
  const suppliedHoursLost = toFiniteNumber(input.timeAccount.hoursLost);
  const suppliedPowerPerTonne = toFiniteNumber(input.efficiency.powerKwhPerMtCane);

  const stoppages = input.stoppages.map((stoppage) => {
    const start = typeof stoppage.startTime === "string" ? stoppage.startTime : "";
    const end = typeof stoppage.endTime === "string" ? stoppage.endTime : "";
    return {
      ...stoppage,
      durationHours: calculateStoppageDuration(start, end),
    };
  });
  const hoursLost = calculateHoursLost(
    availableHours,
    hoursWorked,
    suppliedHoursLost,
  );
  const recovery = calculateRecovery(sugarProduced, caneCrushed);
  const powerExported = calculatePowerExported(powerGenerated, powerUsed);
  const powerKwhPerMtCane = calculatePowerKwhPerMtCane(
    powerUsed,
    caneCrushed,
    suppliedPowerPerTonne,
  );

  return {
    production: { ...input.production, recovery },
    efficiency: { ...input.efficiency, powerKwhPerMtCane },
    timeAccount: {
      ...input.timeAccount,
      hoursLost,
      stoppageHours: calculateTotalStoppageHours(stoppages),
    },
    energy: {
      ...input.energy,
      powerGenerated,
      powerUsed,
      powerExported,
      steamConsumption: toFiniteNumber(input.energy.steamConsumption),
    },
    stoppages,
  };
}

export type KpiThresholds = {
  warning?: number | null;
  critical?: number | null;
  direction?: "HIGH" | "LOW";
};

export function calculateKpiStatus(
  code: KpiCode,
  value: number | null,
  thresholds: KpiThresholds = {},
): "GOOD" | "WATCH" | "CRITICAL" {
  if (value === null) return "GOOD";
  const direction =
    thresholds.direction ??
    (code === "recovery" || code === "power_generated" ? "LOW" : "HIGH");
  const warning = toFiniteNumber(thresholds.warning);
  const critical = toFiniteNumber(thresholds.critical);
  if (direction === "LOW") {
    if (critical !== null && value < critical) return "CRITICAL";
    if (warning !== null && value < warning) return "WATCH";
  } else {
    if (critical !== null && value > critical) return "CRITICAL";
    if (warning !== null && value > warning) return "WATCH";
  }
  return "GOOD";
}