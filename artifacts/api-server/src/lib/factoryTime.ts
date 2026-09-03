export const DEFAULT_FACTORY_TIMEZONE = "Asia/Kolkata";

export function resolveFactoryTimezone(timezone?: string | null): string {
  const candidate = timezone?.trim() || process.env.FACTORY_TIMEZONE?.trim() || DEFAULT_FACTORY_TIMEZONE;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: candidate }).format();
  } catch {
    throw new Error(`Invalid factory timezone "${candidate}".`);
  }
  return candidate;
}

export function getFactoryNow(): Date {
  return new Date();
}

export function getFactoryDate(
  now: Date = getFactoryNow(),
  timezone?: string | null,
): string {
  const resolvedTimezone = resolveFactoryTimezone(timezone);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: resolvedTimezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function formatFactoryDate(
  value: string,
  timezone?: string | null,
): string {
  const resolvedTimezone = resolveFactoryTimezone(timezone);
  const date = new Date(`${value}T12:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: resolvedTimezone,
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(date);
}

export function formatFactoryDateTime(
  value: Date = getFactoryNow(),
  timezone?: string | null,
): string {
  const resolvedTimezone = resolveFactoryTimezone(timezone);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: resolvedTimezone,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  }).formatToParts(value);
  return parts
    .map((part) =>
      part.type === "timeZoneName" && resolvedTimezone === "Asia/Kolkata"
        ? "IST"
        : part.value,
    )
    .join("");
}