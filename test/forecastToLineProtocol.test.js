const test = require("node:test");
const assert = require("node:assert/strict");
const { toLineProtocol, dateDiffInDays } = require("../src/influx/forecastToLineProtocol");

test("dateDiffInDays returns forecast horizon in days", () => {
  assert.equal(dateDiffInDays("2026-05-22", "2026-05-29"), 7);
});

test("toLineProtocol creates extensible snapshot-friendly InfluxDB point", () => {
  const line = toLineProtocol({
    locationName: "London UK",
    issueDate: "2026-05-22",
    generatedAt: "2026-05-22T12:00:00.000Z",
    forecast: {
      source: "open-meteo",
      forecastDate: "2026-05-29",
      minTempC: 10.5,
      maxTempC: 18.9,
      rainChancePct: 43,
      weatherCode: 3,
      description: "overcast"
    }
  });

  assert.match(line, /^forecast_daily,/);
  assert.match(line, /source=open-meteo/);
  assert.match(line, /location=London\\ UK/);
  assert.match(line, /forecast_date=2026-05-29/);
  assert.match(line, /issue_date=2026-05-22/);
  assert.match(line, /horizon_days=7i/);
  assert.match(line, /description="overcast"/);
});
