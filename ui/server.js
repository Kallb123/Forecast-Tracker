import express from "express";
import path from "path";
import fs from "fs";
import rateLimit from "express-rate-limit";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const pkg = JSON.parse(fs.readFileSync(new URL("./package.json", import.meta.url), "utf8"));
const VERSION = pkg.version;

const app = express();

// Rate limit all /api/* routes — 120 requests per IP per minute
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false
});
app.use("/api", apiLimiter);

// ---------------------------------------------------------------------------
// Config — reads the same env vars as the collector but without validation
// ---------------------------------------------------------------------------
function getInfluxConfig() {
  return {
    url: process.env.INFLUX_URL || "http://localhost:8086",
    org: process.env.INFLUX_ORG || "",
    bucket: process.env.INFLUX_BUCKET || "weather_forecasts",
    token: process.env.INFLUX_TOKEN || "",
    defaultLocation: process.env.LOCATION_NAME || "default"
  };
}

// ---------------------------------------------------------------------------
// Input validation helpers
// ---------------------------------------------------------------------------
const RE_DATE = /^\d{4}-\d{2}-\d{2}$/;
const RE_SAFE = /^[a-zA-Z0-9 _\-.]+$/;

function isSafeLocation(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 128 && RE_SAFE.test(value);
}

// ---------------------------------------------------------------------------
// CSV parser for InfluxDB annotated CSV
// ---------------------------------------------------------------------------
function splitCSVLine(line) {
  const result = [];
  let cur = "";
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      result.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  result.push(cur);
  return result;
}

function parseInfluxCSV(csvText) {
  const rows = [];
  let headers = null;

  for (const rawLine of csvText.split("\n")) {
    const line = rawLine.trimEnd();
    if (!line || line.startsWith("#")) continue;

    const cols = splitCSVLine(line);

    if (!headers) {
      headers = cols.map((h) => h.trim());
      continue;
    }

    // A blank first column starts a new table section — reset headers
    if (cols[0] === "" && cols.length > 1 && headers[0] !== "") {
      headers = null;
      continue;
    }

    if (headers) {
      const row = {};
      headers.forEach((h, i) => {
        row[h] = (cols[i] ?? "").trim();
      });
      rows.push(row);
    }
  }

  return rows;
}

// ---------------------------------------------------------------------------
// InfluxDB query helper
// ---------------------------------------------------------------------------
async function queryInflux(fluxQuery) {
  const { url, org, token } = getInfluxConfig();

  const queryUrl = new URL("/api/v2/query", url);
  queryUrl.searchParams.set("org", org);

  const response = await fetch(queryUrl.toString(), {
    method: "POST",
    headers: {
      Authorization: `Token ${token}`,
      "Content-Type": "application/vnd.flux",
      Accept: "application/csv"
    },
    body: fluxQuery
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`InfluxDB query failed (${response.status}): ${err}`);
  }

  return response.text();
}

// ---------------------------------------------------------------------------
// API routes
// ---------------------------------------------------------------------------

// GET /api/locations
app.get("/api/locations", async (_req, res) => {
  try {
    const { bucket } = getInfluxConfig();
    const csv = await queryInflux(`
from(bucket: "${bucket}")
  |> range(start: -3650d)
  |> filter(fn: (r) => r._measurement == "forecast_daily" and r._field == "max_temp_c")
  |> keep(columns: ["location"])
  |> distinct(column: "location")
  |> sort(columns: ["_value"])
`);
    const rows = parseInfluxCSV(csv);
    const locations = [...new Set(rows.map((r) => r._value).filter(Boolean))].sort();
    res.json({ locations });
  } catch (err) {
    console.error("[forecast-ui] /api/locations error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/forecast-dates?location=london
app.get("/api/forecast-dates", async (req, res) => {
  try {
    const { bucket, defaultLocation } = getInfluxConfig();
    const location = req.query.location || defaultLocation;

    if (!isSafeLocation(location)) {
      return res.status(400).json({ error: "Invalid location parameter" });
    }

    const csv = await queryInflux(`
from(bucket: "${bucket}")
  |> range(start: -3650d)
  |> filter(fn: (r) => r._measurement == "forecast_daily" and r._field == "max_temp_c")
  |> filter(fn: (r) => r.location == "${location}")
  |> keep(columns: ["forecast_date"])
  |> distinct(column: "forecast_date")
  |> sort(columns: ["_value"])
`);
    const rows = parseInfluxCSV(csv);
    const dates = [...new Set(rows.map((r) => r._value).filter(Boolean))].sort();
    res.json({ dates });
  } catch (err) {
    console.error("[forecast-ui] /api/forecast-dates error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/forecast-history?date=2026-05-30&location=london
app.get("/api/forecast-history", async (req, res) => {
  try {
    const { bucket, defaultLocation } = getInfluxConfig();
    const date = req.query.date;
    const location = req.query.location || defaultLocation;

    if (!date || !RE_DATE.test(date)) {
      return res.status(400).json({ error: "date parameter required (YYYY-MM-DD)" });
    }
    if (!isSafeLocation(location)) {
      return res.status(400).json({ error: "Invalid location parameter" });
    }

    // Compute the query time window. The validated date string always produces a
    // finite timestamp; reject the unlikely edge case of an invalid calendar date
    // (e.g. "2026-02-31") where the Date constructor would wrap to a different day.
    const forecastTs = new Date(`${date}T00:00:00Z`).getTime();
    if (!Number.isFinite(forecastTs)) {
      return res.status(400).json({ error: "date parameter is not a valid calendar date" });
    }
    // rangeStart/rangeStop are ISO timestamp strings (digits, hyphens, colons, Z only)
    // derived entirely from the server-side Date calculation — no injection risk.
    const rangeStart = new Date(forecastTs - 16 * 86400 * 1000).toISOString();
    const rangeStop = new Date(forecastTs + 2 * 86400 * 1000).toISOString();

    const csv = await queryInflux(`
from(bucket: "${bucket}")
  |> range(start: ${rangeStart}, stop: ${rangeStop})
  |> filter(fn: (r) => r._measurement == "forecast_daily")
  |> filter(fn: (r) => r.forecast_date == "${date}")
  |> filter(fn: (r) => r.location == "${location}")
  |> filter(fn: (r) =>
      r._field == "max_temp_c" or
      r._field == "min_temp_c" or
      r._field == "rain_chance_pct" or
      r._field == "horizon_days")
  |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")
  |> sort(columns: ["_time"])
`);

    const rows = parseInfluxCSV(csv);
    const data = rows
      .filter((r) => r._time && r.max_temp_c !== "")
      .map((r) => ({
        time: r._time,
        issueDate: r.issue_date || "",
        maxTempC: parseFloat(r.max_temp_c),
        minTempC: parseFloat(r.min_temp_c),
        rainChancePct: parseFloat(r.rain_chance_pct),
        horizonDays: parseInt(r.horizon_days, 10)
      }));

    res.json({ date, location, data });
  } catch (err) {
    console.error("[forecast-ui] /api/forecast-history error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/accuracy-by-horizon?location=london
app.get("/api/accuracy-by-horizon", async (req, res) => {
  try {
    const { bucket, defaultLocation } = getInfluxConfig();
    const location = req.query.location || defaultLocation;

    if (!isSafeLocation(location)) {
      return res.status(400).json({ error: "Invalid location parameter" });
    }

    const csv = await queryInflux(`
from(bucket: "${bucket}")
  |> range(start: -3650d)
  |> filter(fn: (r) => r._measurement == "forecast_daily")
  |> filter(fn: (r) => r.location == "${location}")
  |> filter(fn: (r) =>
      r._field == "max_temp_c" or
      r._field == "min_temp_c" or
      r._field == "rain_chance_pct" or
      r._field == "horizon_days")
  |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")
  |> sort(columns: ["_time"])
`);

    const rows = parseInfluxCSV(csv);

    // Group by forecast_date; within each date, key by horizon_days
    const byDate = {};
    for (const r of rows) {
      if (!r.forecast_date || r.max_temp_c === "" || r.horizon_days === "") continue;
      const h = parseInt(r.horizon_days, 10);
      if (!Number.isFinite(h)) continue;
      if (!byDate[r.forecast_date]) byDate[r.forecast_date] = {};
      byDate[r.forecast_date][h] = {
        maxTempC: parseFloat(r.max_temp_c),
        minTempC: parseFloat(r.min_temp_c),
        rainChancePct: parseFloat(r.rain_chance_pct)
      };
    }

    // Accumulate absolute errors per horizon vs the horizon-0 same-day reference forecast
    const acc = {};
    for (let h = 0; h <= 14; h++) {
      acc[h] = { maxTemp: [], minTemp: [], rainChance: [] };
    }

    for (const horizons of Object.values(byDate)) {
      const actual = horizons[0];
      if (!actual) continue;
      for (let h = 0; h <= 14; h++) {
        const f = horizons[h];
        if (!f) continue;
        acc[h].maxTemp.push(Math.abs(f.maxTempC - actual.maxTempC));
        acc[h].minTemp.push(Math.abs(f.minTempC - actual.minTempC));
        acc[h].rainChance.push(Math.abs(f.rainChancePct - actual.rainChancePct));
      }
    }

    function mae(arr) {
      if (!arr.length) return null;
      return arr.reduce((s, v) => s + v, 0) / arr.length;
    }

    function variance(arr) {
      if (arr.length < 2) return null;
      const mean = arr.reduce((s, v) => s + v, 0) / arr.length;
      return arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length;
    }

    const accuracy = [];
    for (let h = 0; h <= 14; h++) {
      const a = acc[h];
      accuracy.push({
        horizon: h,
        count: a.maxTemp.length,
        maxTempMAE: mae(a.maxTemp),
        maxTempVariance: variance(a.maxTemp),
        minTempMAE: mae(a.minTemp),
        minTempVariance: variance(a.minTemp),
        rainChanceMAE: mae(a.rainChance),
        rainChanceVariance: variance(a.rainChance)
      });
    }

    res.json({ location, accuracy });
  } catch (err) {
    console.error("[forecast-ui] /api/accuracy-by-horizon error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/health
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", version: VERSION });
});

// ---------------------------------------------------------------------------
// Serve built Vue app (production)
// ---------------------------------------------------------------------------
const UI_DIST = path.join(__dirname, "dist");

if (fs.existsSync(UI_DIST)) {
  app.use(express.static(UI_DIST));
  app.get(/(.*)/, (_req, res) => {
    res.sendFile(path.join(UI_DIST, "index.html"));
  });
} else {
  console.warn(
    "[forecast-ui] ui/dist not found — static UI will not be served. " +
      "Run `npm run build` inside the ui/ directory first."
  );
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
const PORT = parseInt(process.env.UI_PORT || "3000", 10);
app.listen(PORT, "0.0.0.0", () => {
  console.log(`[forecast-ui] v${VERSION} listening on http://0.0.0.0:${PORT}`);
});
