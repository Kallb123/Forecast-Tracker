const DAY_MS = 24 * 60 * 60 * 1000;

function parseDays(value) {
  const days = Number.parseInt(value ?? "14", 10);
  if (Number.isNaN(days)) return 14;
  return Math.max(7, Math.min(14, days));
}

function parseBoolean(value, defaultValue = false) {
  if (value === undefined) return defaultValue;
  return value.toLowerCase() === "true";
}

function getConfig() {
  const sourceName = process.env.FORECAST_SOURCE ?? "open-meteo";
  if (sourceName !== "open-meteo") {
    throw new Error(`Unsupported FORECAST_SOURCE "${sourceName}"`);
  }

  const influx = {
    url: process.env.INFLUX_URL,
    org: process.env.INFLUX_ORG,
    bucket: process.env.INFLUX_BUCKET,
    token: process.env.INFLUX_TOKEN
  };

  return {
    app: {
      locationName: process.env.LOCATION_NAME ?? "default",
      latitude: Number.parseFloat(process.env.LATITUDE ?? "0"),
      longitude: Number.parseFloat(process.env.LONGITUDE ?? "0"),
      forecastDays: parseDays(process.env.FORECAST_DAYS),
      intervalMs: DAY_MS,
      runOnStart: parseBoolean(process.env.RUN_ON_START, true),
      dryRun: parseBoolean(process.env.DRY_RUN, false)
    },
    source: {
      name: sourceName
    },
    influx
  };
}

module.exports = { DAY_MS, getConfig };
