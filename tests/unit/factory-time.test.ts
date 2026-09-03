import assert from "node:assert/strict";
import test from "node:test";
import {
  formatFactoryDate,
  formatFactoryDateTime,
  getFactoryDate,
  resolveFactoryTimezone,
} from "../../artifacts/api-server/src/lib/factoryTime";

test("uses the factory-local date before and after India midnight", () => {
  assert.equal(getFactoryDate(new Date("2026-09-03T18:29:00.000Z"), "Asia/Kolkata"), "2026-09-03");
  assert.equal(getFactoryDate(new Date("2026-09-03T18:31:00.000Z"), "Asia/Kolkata"), "2026-09-04");
});

test("does not use the UTC calendar date as the reporting date", () => {
  assert.equal(getFactoryDate(new Date("2026-09-03T00:01:00.000Z"), "Asia/Kolkata"), "2026-09-03");
  assert.equal(getFactoryDate(new Date("2026-09-02T18:29:00.000Z"), "Asia/Kolkata"), "2026-09-02");
});

test("formats reporting dates and generated timestamps in the configured timezone", () => {
  assert.equal(formatFactoryDate("2026-09-03", "Asia/Kolkata"), "03 September 2026");
  assert.match(
    formatFactoryDateTime(new Date("2026-09-03T18:31:00.000Z"), "Asia/Kolkata"),
    /^04 Sept 2026, 00:01 IST$/,
  );
});

test("rejects an invalid configured timezone", () => {
  assert.throws(() => resolveFactoryTimezone("Not/A_Timezone"), /Invalid factory timezone/);
});