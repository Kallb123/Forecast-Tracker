const { getConfig } = require("./config");
const { OpenMeteoSource } = require("./sources/openMeteoSource");
const { buildPayload } = require("./influx/forecastToLineProtocol");
const { InfluxWriter } = require("./influx/influxWriter");

const { version: VERSION } = require("../package.json");

function validateConfig(config) {
  const { latitude, longitude } = config.app;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new Error("LATITUDE and LONGITUDE must be valid numbers");
  }

  if (!config.app.dryRun) {
    const requiredInfluxKeys = ["url", "org", "bucket", "token"];
    for (const key of requiredInfluxKeys) {
      if (!config.influx[key]) {
        throw new Error(`Missing required INFLUX_${key.toUpperCase()} environment variable`);
      }
    }
  }
}

function createSource(config) {
  if (config.source.name === "open-meteo") {
    return new OpenMeteoSource();
  }
  throw new Error(`Unknown source ${config.source.name}`);
}

async function runCollectionCycle(config = getConfig()) {
  validateConfig(config);
  const source = createSource(config);
  const influxWriter = new InfluxWriter();
  const generatedAt = new Date().toISOString();
  const issueDate = generatedAt.slice(0, 10);
  const forecasts = await source.fetchDailyForecast({
    latitude: config.app.latitude,
    longitude: config.app.longitude,
    forecastDays: config.app.forecastDays
  });

  const payload = buildPayload({
    locationName: config.app.locationName,
    issueDate,
    generatedAt,
    forecasts
  });

  if (config.app.dryRun) {
    console.log(payload);
    return { count: forecasts.length, dryRun: true };
  }

  await influxWriter.writeForecastPayload({
    ...config.influx,
    payload
  });

  return { count: forecasts.length, dryRun: false };
}

function startScheduler(config = getConfig()) {
  const execute = async () => {
    try {
      const result = await runCollectionCycle(config);
      console.log(`[forecast-tracker] stored ${result.count} forecasts (dryRun=${result.dryRun})`);
    } catch (error) {
      console.error("[forecast-tracker] collection cycle failed:", error);
    }
  };

  if (config.app.runOnStart) {
    execute();
  }

  setInterval(execute, config.app.intervalMs);
}

if (require.main === module) {
  console.log(`[forecast-tracker] v${VERSION} starting`);
  startScheduler();
}

module.exports = { runCollectionCycle, startScheduler, validateConfig };
